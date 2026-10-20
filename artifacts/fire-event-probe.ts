/// <reference path="../api/apps/home-assistant-dev-fire-event.d.ts" />
import { actions, entityProperty, HomeAssistant, raw, requestJson, stringifyJson, text, type NativeEntity } from "@js-shortcuts/ios";

// Simulator probe for the alarm shortcut's Fire Event path (Home Assistant dev build).
// The simulator has no Clock app: settings entities stand in for alarms, with the same
// entityProperty → object → stringifyJson pipeline. The JSON text is also posted to the
// local echo server (python3 scripts/http-echo.py) so the exact event data is observable.
// Compile with --app api/apps/home-assistant-dev-fire-event.json.
type SilentMode = NativeEntity<"com.apple.Preferences.SilentModeEntity">;
type Clock24 = NativeEntity<"com.apple.Preferences.TwentyFourHourTimeEntity">;

export default async function main(): Promise<void> {
  const silent = await actions["com.apple.Preferences.SilentModeEntity"]<SilentMode[]>({});
  const clock = await actions["com.apple.Preferences.TwentyFourHourTimeEntity"]<Clock24[]>({});
  const alarms = [
    ...silent.map(item => ({ label: "Silent", hours: 7, minutes: 30, enabled: entityProperty(item, "value"), repeats: true, repeatDays: "Monday, Tuesday" })),
    ...clock.map(item => ({ label: "", hours: 0, minutes: 5, enabled: entityProperty(item, "value"), repeats: false, repeatDays: "" })),
  ];
  const eventData = stringifyJson({ alarms });
  await requestJson<Record<string, unknown>>("http://127.0.0.1:8765/echo?case=fire-event-data", { method: "POST", json: { eventData } });
  await HomeAssistant.fireEvent({
    server: raw({ identifier: "only-server", title: { key: "Home Assistant" }, subtitle: { key: "Home Assistant" } }),
    eventName: "iphone_wekkers",
    eventData: text(eventData),
  });
}
