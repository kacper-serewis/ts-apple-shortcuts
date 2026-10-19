// Generated from App Intents metadata. Availability and native bindings are separate.
declare module "@js-shortcuts/ios" {
  export namespace HomeAssistantRelease {
    export interface Entity<Name extends string> extends NativeContent { readonly __appEntity: Name; readonly __appBundle: "io.robbie.HomeAssistant" }
    export type DimmableLightAppEntity = Entity<"DimmableLightAppEntity">;
    /** Native export binding available. */
    export function setBrightness(parameters: { "light": Entity<"DimmableLightAppEntity"> | NativeEncoded; "brightness": number | NativeEncoded }): Promise<void>;
  }
}
