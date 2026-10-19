/// <reference path="../../api/apps/home-assistant-dev.d.ts" />
import { HomeAssistant, raw } from "@js-shortcuts/ios";

// Simulator/development bundle. Compile with --app api/apps/home-assistant-dev.json.
// Ask Each Time was captured from a native shortcut; select the lamp on-device.
// The intended physical-device test is light.globe at 50%, after binding the release app.
export default async function main(): Promise<void> {
  await HomeAssistant.setBrightness({
    light: raw({ Value: { Type: "Ask" }, WFSerializationType: "WFTextTokenAttachment" }),
    brightness: 50,
  });
}
