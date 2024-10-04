/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

/** Normally, a consumer could require and use this and get the same instance. But if -core is npm linked, there may be two instances of file in play. */
import { Protocol as Crdp } from "devtools-protocol";
import { logger } from "vscode-debugadapter";

import { Breakpoints } from "./chrome/breakpoints";
import * as chromeConnection from "./chrome/chromeConnection";
import {
	ChromeDebugAdapter,
	IOnPausedResult,
	LoadedSourceEventReason,
} from "./chrome/chromeDebugAdapter";
import {
	ChromeDebugSession,
	IChromeDebugSessionOpts,
} from "./chrome/chromeDebugSession";
import * as chromeTargetDiscoveryStrategy from "./chrome/chromeTargetDiscoveryStrategy";
import {
	TargetVersions,
	Version,
} from "./chrome/chromeTargetDiscoveryStrategy";
import * as chromeUtils from "./chrome/chromeUtils";
import { InternalSourceBreakpoint } from "./chrome/internalSourceBreakpoint";
import { ScriptContainer } from "./chrome/scripts";
import * as stoppedEvent from "./chrome/stoppedEvent";
import * as variables from "./chrome/variables";
import { ErrorWithMessage } from "./errors";
import * as executionTimingsReporter from "./executionTimingsReporter";
import { NullLogger } from "./nullLogger";
import * as telemetry from "./telemetry";
import { BasePathTransformer } from "./transformers/basePathTransformer";
import { BaseSourceMapTransformer } from "./transformers/baseSourceMapTransformer";
import { LineColTransformer } from "./transformers/lineNumberTransformer";
import { UrlPathTransformer } from "./transformers/urlPathTransformer";
import * as utils from "./utils";

export * from "./debugAdapterInterfaces";

export {
	chromeConnection,
	ChromeDebugAdapter,
	ChromeDebugSession,
	IOnPausedResult,
	IChromeDebugSessionOpts,
	chromeTargetDiscoveryStrategy,
	chromeUtils,
	logger,
	stoppedEvent,
	LoadedSourceEventReason,
	InternalSourceBreakpoint,
	ErrorWithMessage,
	UrlPathTransformer,
	BasePathTransformer,
	LineColTransformer,
	BaseSourceMapTransformer,
	utils,
	telemetry,
	variables,
	NullLogger,
	executionTimingsReporter,
	Version,
	TargetVersions,
	Crdp,
	Breakpoints,
	ScriptContainer,
};
