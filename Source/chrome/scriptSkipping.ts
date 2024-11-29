/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { Protocol as Crdp } from "devtools-protocol";
import { logger } from "vscode-debugadapter";

import { IToggleSkipFileStatusArgs } from "../debugAdapterInterfaces";
import * as utils from "../utils";
import { ChromeConnection } from "./chromeConnection";
import { Transformers } from "./chromeDebugAdapter";
import { ScriptContainer } from "./scripts";

export class ScriptSkipper {
	private _skipFileStatuses = new Map<string, boolean>();

	private _blackboxedRegexes: RegExp[] = [];

	private get chrome() {
		return this._chromeConnection.api;
	}

	constructor(
		private readonly _chromeConnection: ChromeConnection,
		private readonly _transformers: Transformers,
	) {}

	public init(skipFiles, skipFileRegExps) {
		let patterns: string[] = [];

		if (skipFiles) {
			const skipFilesArgs = skipFiles.filter((glob) => {
				if (glob.startsWith("!")) {
					logger.warn(
						`Warning: skipFiles entries starting with '!' aren't supported and will be ignored. ("${glob}")`,
					);

					return false;
				}

				return true;
			});

			patterns = skipFilesArgs.map((glob) =>
				utils.pathGlobToBlackboxedRegex(glob),
			);
		}

		if (skipFileRegExps) {
			patterns = patterns.concat(skipFileRegExps);
		}

		if (patterns.length) {
			this._blackboxedRegexes = patterns.map(
				(pattern) => new RegExp(pattern, "i"),
			);

			this.refreshBlackboxPatterns();
		}
	}

	public async toggleSkipFileStatus(
		args: IToggleSkipFileStatusArgs,
		scripts: ScriptContainer,
		transformers: Transformers,
	) {
		// e.g. strip <node_internals>/
		if (args.path) {
			args.path = scripts.displayPathToRealPath(args.path);
		}

		const aPath =
			args.path ||
			scripts.fakeUrlForSourceReference(args.sourceReference);

		const generatedPath =
			await transformers.sourceMapTransformer.getGeneratedPathFromAuthoredPath(
				aPath,
			);

		if (!generatedPath) {
			logger.log(
				`Can't toggle the skipFile status for: ${aPath} - haven't seen it yet.`,
			);

			return;
		}

		const sources =
			await transformers.sourceMapTransformer.allSources(generatedPath);

		if (generatedPath === aPath && sources.length) {
			// Ignore toggling skip status for generated scripts with sources
			logger.log(
				`Can't toggle skipFile status for ${aPath} - it's a script with a sourcemap`,
			);

			return;
		}

		const newStatus = !this.shouldSkipSource(aPath);

		logger.log(
			`Setting the skip file status for: ${aPath} to ${newStatus}`,
		);

		this._skipFileStatuses.set(aPath, newStatus);

		const targetPath =
			transformers.pathTransformer.getTargetPathFromClientPath(
				generatedPath,
			) || generatedPath;

		const script = scripts.getScriptByUrl(targetPath);

		await this.resolveSkipFiles(
			script,
			generatedPath,
			sources,
			/*toggling=*/ true,
		);

		if (newStatus) {
			this.makeRegexesSkip(script.url);
		} else {
			this.makeRegexesNotSkip(script.url);
		}
	}

	public async resolveSkipFiles(
		script: Crdp.Debugger.ScriptParsedEvent,
		mappedUrl: string,
		sources: string[],
		toggling?: boolean,
	): Promise<void> {
		if (sources && sources.length) {
			const parentIsSkipped = this.shouldSkipSource(script.url);

			const libPositions: Crdp.Debugger.ScriptPosition[] = [];

			// Figure out skip/noskip transitions within script
			let inLibRange = parentIsSkipped;

			for (let s of sources) {
				let isSkippedFile = this.shouldSkipSource(s);

				if (typeof isSkippedFile !== "boolean") {
					// Inherit the parent's status
					isSkippedFile = parentIsSkipped;
				}

				this._skipFileStatuses.set(s, isSkippedFile);

				if (
					(isSkippedFile && !inLibRange) ||
					(!isSkippedFile && inLibRange)
				) {
					const details =
						await this._transformers.sourceMapTransformer.allSourcePathDetails(
							mappedUrl,
						);

					const detail = details.find((d) => d.inferredPath === s);

					if (detail.startPosition) {
						libPositions.push({
							lineNumber: detail.startPosition.line,
							columnNumber: detail.startPosition.column,
						});
					}

					inLibRange = !inLibRange;
				}
			}

			// If there's any change from the default, set proper blackboxed ranges
			if (libPositions.length || toggling) {
				if (parentIsSkipped) {
					libPositions.splice(0, 0, {
						lineNumber: 0,
						columnNumber: 0,
					});
				}

				if (
					libPositions[0].lineNumber !== 0 ||
					libPositions[0].columnNumber !== 0
				) {
					// The list of blackboxed ranges must start with 0,0 for some reason.
					// https://github.com/Microsoft/vscode-chrome-debug/issues/667
					libPositions[0] = {
						lineNumber: 0,
						columnNumber: 0,
					};
				}

				await this.chrome.Debugger.setBlackboxedRanges({
					scriptId: script.scriptId,
					positions: [],
				}).catch(() => this.warnNoSkipFiles());

				if (libPositions.length) {
					this.chrome.Debugger.setBlackboxedRanges({
						scriptId: script.scriptId,
						positions: libPositions,
					}).catch(() => this.warnNoSkipFiles());
				}
			}
		} else {
			const status = await this.getSkipStatus(mappedUrl);

			const skippedByPattern = this.matchesSkipFilesPatterns(mappedUrl);

			if (typeof status === "boolean" && status !== skippedByPattern) {
				const positions = status
					? [{ lineNumber: 0, columnNumber: 0 }]
					: [];

				this.chrome.Debugger.setBlackboxedRanges({
					scriptId: script.scriptId,
					positions,
				}).catch(() => this.warnNoSkipFiles());
			}
		}
	}

	private makeRegexesNotSkip(noSkipPath: string): void {
		let somethingChanged = false;

		this._blackboxedRegexes = this._blackboxedRegexes.map((regex) => {
			const result = utils.makeRegexNotMatchPath(regex, noSkipPath);

			somethingChanged = somethingChanged || result !== regex;

			return result;
		});

		if (somethingChanged) {
			this.refreshBlackboxPatterns();
		}
	}

	private makeRegexesSkip(skipPath: string): void {
		let somethingChanged = false;

		this._blackboxedRegexes = this._blackboxedRegexes.map((regex) => {
			const result = utils.makeRegexMatchPath(regex, skipPath);

			somethingChanged = somethingChanged || result !== regex;

			return result;
		});

		if (!somethingChanged) {
			this._blackboxedRegexes.push(
				new RegExp(utils.pathToRegex(skipPath), "i"),
			);
		}

		this.refreshBlackboxPatterns();
	}

	private refreshBlackboxPatterns(): void {
		this.chrome.Debugger.setBlackboxPatterns({
			patterns: this._blackboxedRegexes.map((regex) => regex.source),
		}).catch(() => this.warnNoSkipFiles());
	}

	/**
	 * If the source has a saved skip status, return that, whether true or false.
	 * If not, check it against the patterns list.
	 */
	public shouldSkipSource(sourcePath: string): boolean | undefined {
		const status = this.getSkipStatus(sourcePath);

		if (typeof status === "boolean") {
			return status;
		}

		if (this.matchesSkipFilesPatterns(sourcePath)) {
			return true;
		}

		return undefined;
	}

	/**
	 * Returns true if this path matches one of the static skip patterns
	 */
	private matchesSkipFilesPatterns(sourcePath: string): boolean {
		return this._blackboxedRegexes.some((regex) => {
			return regex.test(sourcePath);
		});
	}

	/**
	 * Returns the current skip status for this path, which is either an authored or generated script.
	 */
	private getSkipStatus(sourcePath: string): boolean | undefined {
		if (this._skipFileStatuses.has(sourcePath)) {
			return this._skipFileStatuses.get(sourcePath);
		}

		return undefined;
	}

	private warnNoSkipFiles(): void {
		logger.log("Warning: this runtime does not support skipFiles");
	}
}
