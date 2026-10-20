import { actions, entityProperty, requestJson, type NativeEntity } from "@js-shortcuts/ios";

// Simulator probe for entityProperty(): the iOS simulator has no Clock app, so this
// reads App Intents entities that exist there and posts them like the alarm shortcut.
// Start python3 scripts/http-echo.py first; requests are logged locally.
type Contact = NativeEntity<"com.apple.MobileAddressBook.ContactEntity">;
type Photo = NativeEntity<"com.apple.mobileslideshow.AssetEntity">;
type SilentMode = NativeEntity<"com.apple.Preferences.SilentModeEntity">;
type Clock24 = NativeEntity<"com.apple.Preferences.TwentyFourHourTimeEntity">;

export default async function main(): Promise<void> {
  const contacts = await actions["com.apple.MobileAddressBook.ContactEntity"]<Contact[]>({});
  const people = contacts.map(contact => ({
    organization: entityProperty(contact, "organizationName"),
    job: entityProperty(contact, "jobTitle"),
    type: entityProperty(contact, "contactType"),
  }));
  const photos = await actions["com.apple.mobileslideshow.AssetEntity"]<Photo[]>({});
  const pictures = photos.map(photo => ({
    favorite: entityProperty(photo, "isFavorite"),
    hidden: entityProperty(photo, "isHidden"),
    kind: entityProperty(photo, "assetType"),
  }));
  const silent = await actions["com.apple.Preferences.SilentModeEntity"]<SilentMode[]>({});
  const clock = await actions["com.apple.Preferences.TwentyFourHourTimeEntity"]<Clock24[]>({});
  const settings = [
    ...silent.map(item => ({ name: "silent", on: entityProperty(item, "value") })),
    ...clock.map(item => ({ name: "24h", on: entityProperty(item, "value") })),
  ];
  let favorites = 0;
  for (const photo of photos) {
    if (entityProperty(photo, "isFavorite")) { favorites += 1; }
  }
  await requestJson<Record<string, unknown>>("http://127.0.0.1:8765/echo?case=entity-properties", {
    method: "POST",
    json: { people, pictures, settings, favorites, contactCount: contacts.length },
  });
}
