/// <reference path="../../api/apps/home-assistant-release-fire-event.d.ts" />
import { actions, entityProperty, HomeAssistantRelease, raw, stringifyJson, text, type NativeEntity } from "@js-shortcuts/ios";

// "Wekkers → Home Assistant": fire the Home Assistant event `iphone_wekkers` with every
// Clock alarm as event data: {"alarms":[{label,hours,minutes,enabled,repeats,repeatDays}]}.
// With no alarms the data is {"alarms":[]}. Runs silently (no dialogs), so a personal
// automation such as "Clock app is opened/closed" can start it.
// Compile with --app api/apps/home-assistant-release-fire-event.json (App Store app).
type Alarm = NativeEntity<"com.apple.clock.AlarmEntity">;

export default async function main(): Promise<void> {
  // Find Alarms returns a list of alarm entities; the catalog declares a single entity.
  const found = await actions["com.apple.mobiletimer-framework.MobileTimerIntents.MTGetAlarmsIntent"]<Alarm[]>({});
  const alarms = found.map(alarm => ({
    label: entityProperty(alarm, "label"),
    hours: entityProperty(alarm, "hours"),
    minutes: entityProperty(alarm, "minutes"),
    enabled: entityProperty(alarm, "enabled"),
    repeats: entityProperty(alarm, "repeats"),
    // Localized day names ("Monday" or "maandag"); empty when the alarm does not repeat.
    repeatDays: entityProperty(alarm, "repeatDays").join(", "),
  }));
  await HomeAssistantRelease.fireEvent({
    // The app resolves a server identifier it does not know to its only configured
    // server (Home Assistant 2026.9.3+). With several servers, select one on the device.
    server: raw({ identifier: "only-server", title: { key: "Home Assistant" }, subtitle: { key: "Home Assistant" } }),
    eventName: "iphone_wekkers",
    // Fire Event takes JSON text; an object without eventName/eventData keys is the event data.
    eventData: text(stringifyJson({ alarms })),
  });
}
