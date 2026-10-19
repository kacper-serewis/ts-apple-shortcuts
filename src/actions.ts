import type { ActionName, PlistDictionary } from "./model.js";

export interface ActionDefinition {
  id: string;
  parameter: string;
  defaults?: PlistDictionary;
  output?: string;
}

// Compiler intrinsics: source imports are resolved here, never executed.
export const actions: ReadonlyMap<ActionName, ActionDefinition> = new Map<ActionName, ActionDefinition>([
  ["askText", { id: "ask", parameter: "WFAskActionPrompt", defaults: { WFInputType: "Text" }, output: "Provided Input" }],
  ["showResult", { id: "showresult", parameter: "Text" }],
  ["notify", { id: "notification", parameter: "WFNotificationActionBody", defaults: { WFNotificationActionSound: false } }],
  ["speak", { id: "speaktext", parameter: "WFText", defaults: { WFSpeakTextWait: true } }],
  ["getJson", {
    id: "downloadurl", parameter: "WFURL", output: "Contents of URL",
    defaults: {
      WFHTTPMethod: "GET",
      WFHTTPHeaders: {
        WFSerializationType: "WFDictionaryFieldValue",
        Value: { WFDictionaryFieldValueItems: [{
          WFItemType: 0,
          WFKey: { Value: { string: "Accept" }, WFSerializationType: "WFTextTokenString" },
          WFValue: { Value: { string: "application/json" }, WFSerializationType: "WFTextTokenString" },
        }] },
      },
    },
  }],
]);
