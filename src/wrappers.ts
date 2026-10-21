import type { PlistDictionary } from "./model.js";

export interface Wrapper {
  identifier: string;
  args: { key: string; encoding: "auto" | "text" | "attachment" | "token" }[];
  defaults?: PlistDictionary;
  output?: string;
  dictionaryInput?: number;
}
const arg = (key: string, encoding: "auto" | "text" | "attachment" | "token" = "auto") => ({ key, encoding });
export const wrappers: Record<string, Wrapper> = {
  askNumber: { identifier: "ask", args: [arg("WFAskActionPrompt", "text")], defaults: { WFInputType: "Number", WFAskActionAllowsDecimalNumbers: true, WFAskActionAllowsNegativeNumbers: true }, output: "Provided Input" },
  getClipboard: { identifier: "getclipboard", args: [], output: "Clipboard" },
  setClipboard: { identifier: "setclipboard", args: [arg("WFInput", "attachment")] },
  openURL: { identifier: "openurl", args: [arg("WFInput", "text")] },
  quickLook: { identifier: "previewdocument", args: [arg("WFInput", "attachment")] },
  chooseFromList: { identifier: "choosefromlist", args: [arg("WFInput", "attachment"), arg("WFChooseFromListActionPrompt", "text")], defaults: { WFChooseFromListActionSelectMultiple: false }, output: "Chosen Item" },
  chooseMultiple: { identifier: "choosefromlist", args: [arg("WFInput", "attachment"), arg("WFChooseFromListActionPrompt", "text")], defaults: { WFChooseFromListActionSelectMultiple: true }, output: "Chosen Items" },
  splitText: { identifier: "text.split", args: [arg("text", "text"), arg("WFTextCustomSeparator", "text")], defaults: { WFTextSeparator: "Custom" }, output: "Split Text" },
  joinText: { identifier: "text.combine", args: [arg("text", "attachment"), arg("WFTextCustomSeparator", "text")], defaults: { WFTextSeparator: "Custom" }, output: "Combined Text" },
  replaceText: { identifier: "text.replace", args: [arg("WFInput", "text"), arg("WFReplaceTextFind", "text"), arg("WFReplaceTextReplace", "text")], defaults: { WFReplaceTextCaseSensitive: true, WFReplaceTextRegularExpression: false }, output: "Updated Text" },
  replaceRegex: { identifier: "text.replace", args: [arg("WFInput", "text"), arg("WFReplaceTextFind", "text"), arg("WFReplaceTextReplace", "text")], defaults: { WFReplaceTextCaseSensitive: true, WFReplaceTextRegularExpression: true }, output: "Updated Text" },
  matchText: { identifier: "text.match", args: [arg("text", "text"), arg("WFMatchTextPattern", "text")], defaults: { WFMatchTextCaseSensitive: true }, output: "Matches" },
  count: { identifier: "count", args: [arg("Input", "attachment")], defaults: { WFCountType: "Items" }, output: "Count" },
  wait: { identifier: "delay", args: [arg("WFDelayTime")] },
  vibrate: { identifier: "vibrate", args: [] },
  currentDate: { identifier: "date", args: [], defaults: { WFDateActionMode: "Current Date" }, output: "Date" },
  // WFDate is a date text field: as a bare attachment, Format Date returned nothing on iOS/macOS.
  formatDate: { identifier: "format.date", args: [arg("WFDate", "text"), arg("WFDateFormat", "text")], defaults: { WFDateFormatStyle: "Custom" }, output: "Formatted Date" },
  getBatteryLevel: { identifier: "getbatterylevel", args: [], output: "Battery Level" },
  getDictionaryValue: { identifier: "getvalueforkey", args: [arg("WFInput", "attachment"), arg("WFDictionaryKey", "text")], defaults: { WFGetDictionaryValueType: "Value" }, output: "Dictionary Value", dictionaryInput: 0 },
  dictionaryKeys: { identifier: "getvalueforkey", args: [arg("WFInput", "attachment")], defaults: { WFGetDictionaryValueType: "All Keys" }, output: "Dictionary Value", dictionaryInput: 0 },
  dictionaryValues: { identifier: "getvalueforkey", args: [arg("WFInput", "attachment")], defaults: { WFGetDictionaryValueType: "All Values" }, output: "Dictionary Value", dictionaryInput: 0 },
  setDictionaryValue: { identifier: "setvalueforkey", args: [arg("WFDictionary", "attachment"), arg("WFDictionaryKey", "text"), arg("WFDictionaryValue", "token")], output: "Dictionary", dictionaryInput: 0 },
};
