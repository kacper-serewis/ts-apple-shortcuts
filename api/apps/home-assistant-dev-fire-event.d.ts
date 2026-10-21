// Generated from App Intents metadata. Availability and native bindings are separate.
declare module "@js-shortcuts/ios" {
  export namespace HomeAssistant {
    export interface Entity<Name extends string> extends NativeContent { readonly __appEntity: Name; readonly __appBundle: "io.robbie.HomeAssistant.dev" }
    export type AssistPipelineEntity = Entity<"AssistPipelineEntity">;
    export type CalendarAttendeeSchemaEntity = Entity<"CalendarAttendeeSchemaEntity">;
    export type CalendarEventSchemaEntity = Entity<"CalendarEventSchemaEntity">;
    export type CalendarSchemaEntity = Entity<"CalendarSchemaEntity">;
    export type ControllableEntityAppEntity = Entity<"ControllableEntityAppEntity">;
    export type CustomWidgetEntity = Entity<"CustomWidgetEntity">;
    export type DimmableLightAppEntity = Entity<"DimmableLightAppEntity">;
    export type FocusNameAppEntity = Entity<"FocusNameAppEntity">;
    export type HAAppEntityAppIntentEntity = Entity<"HAAppEntityAppIntentEntity">;
    export type HACalendarAppEntity = Entity<"HACalendarAppEntity">;
    export type HACalendarEventAppEntity = Entity<"HACalendarEventAppEntity">;
    export type HAEntityStateAppEntity = Entity<"HAEntityStateAppEntity">;
    export type IntentActionEntity = Entity<"IntentActionEntity">;
    export type IntentAutomationEntity = Entity<"IntentAutomationEntity">;
    export type IntentCameraEntity = Entity<"IntentCameraEntity">;
    export type IntentCoverEntity = Entity<"IntentCoverEntity">;
    export type IntentFanEntity = Entity<"IntentFanEntity">;
    export type IntentLightEntity = Entity<"IntentLightEntity">;
    export type IntentSceneEntity = Entity<"IntentSceneEntity">;
    export type IntentScriptEntity = Entity<"IntentScriptEntity">;
    export type IntentSensorsAppEntity = Entity<"IntentSensorsAppEntity">;
    export type IntentServerAppEntity = Entity<"IntentServerAppEntity">;
    export type IntentSwitchEntity = Entity<"IntentSwitchEntity">;
    export type LocationTriggerSchemaEntity = Entity<"LocationTriggerSchemaEntity">;
    export type LockAppEntity = Entity<"LockAppEntity">;
    export type OpenableEntityAppEntity = Entity<"OpenableEntityAppEntity">;
    export type PageAppEntity = Entity<"PageAppEntity">;
    export type ReadableEntityAppEntity = Entity<"ReadableEntityAppEntity">;
    export type ReminderListSchemaEntity = Entity<"ReminderListSchemaEntity">;
    export type ReminderSchemaEntity = Entity<"ReminderSchemaEntity">;
    export type ReminderSectionSchemaEntity = Entity<"ReminderSectionSchemaEntity">;
    export type SFSymbolEntity = Entity<"SFSymbolEntity">;
    export type ThermostatAppEntity = Entity<"ThermostatAppEntity">;
    export type TodoListAppEntity = Entity<"TodoListAppEntity">;
    export type WidgetCalendarAppEntity = Entity<"WidgetCalendarAppEntity">;
    export type WidgetCircularComplicationAppEntity = Entity<"WidgetCircularComplicationAppEntity">;
    export type WidgetDetailsAttributeAppEntity = Entity<"WidgetDetailsAttributeAppEntity">;
    export type WidgetDomainAppEntity = Entity<"WidgetDomainAppEntity">;
    export type WidgetEntitiesAppEntity = Entity<"WidgetEntitiesAppEntity">;
    export type WidgetGaugeAttributeAppEntity = Entity<"WidgetGaugeAttributeAppEntity">;
    export type WidgetRectangularComplicationAppEntity = Entity<"WidgetRectangularComplicationAppEntity">;
    /** Requires a native export binding before compilation. */
    export function addEntityTo(parameters: { "entity": Entity<"HAAppEntityAppIntentEntity"> | NativeEncoded; "destination": "appleWatch" | "carPlay" | "macToolbar" | NativeEncoded }): Promise<void>;
    /** Requires a native export binding before compilation. */
    export function assistAppIntent(parameters: { "pipeline": Entity<"AssistPipelineEntity"> | NativeEncoded; "withVoice": boolean | NativeEncoded }): Promise<void>;
    /** Requires a native export binding before compilation. */
    export function assistIntent(parameters: { "prompt": string | NativeEncoded; "pipeline"?: Entity<"AssistPipelineEntity"> | NativeEncoded }): Promise<string>;
    /** Requires a native export binding before compilation. */
    export function automation(parameters: { "automation": Entity<"IntentAutomationEntity"> | NativeEncoded; "showConfirmationNotification": boolean | NativeEncoded; "hapticConfirmation": boolean | NativeEncoded }): Promise<boolean>;
    /** Requires a native export binding before compilation. */
    export function callService(parameters: { "server": Entity<"IntentServerAppEntity"> | NativeEncoded; "action": Entity<"IntentActionEntity"> | NativeEncoded; "payload": string | NativeEncoded }): Promise<string>;
    /** Requires a native export binding before compilation. */
    export function controlAssistConfiguration(parameters: { "pipeline"?: Entity<"AssistPipelineEntity"> | NativeEncoded; "displayText"?: string | NativeEncoded }): Promise<void>;
    /** Requires a native export binding before compilation. */
    export function controlOpenCameraConfiguration(parameters: { "entity"?: Entity<"HAAppEntityAppIntentEntity"> | NativeEncoded; "icon"?: Entity<"SFSymbolEntity"> | NativeEncoded; "displayText"?: string | NativeEncoded }): Promise<void>;
    /** Requires a native export binding before compilation. */
    export function controlOpenEntityConfiguration(parameters: { "entity"?: Entity<"HAAppEntityAppIntentEntity"> | NativeEncoded; "icon"?: Entity<"SFSymbolEntity"> | NativeEncoded; "displayText"?: string | NativeEncoded }): Promise<void>;
    /** Requires a native export binding before compilation. */
    export function controlOpenPageConfiguration(parameters: { "page"?: Entity<"PageAppEntity"> | NativeEncoded; "icon"?: Entity<"SFSymbolEntity"> | NativeEncoded; "displayText"?: string | NativeEncoded }): Promise<void>;
    /** Requires a native export binding before compilation. */
    export function cover(parameters: { "entity": Entity<"IntentCoverEntity"> | NativeEncoded; "value": boolean | NativeEncoded; "toggle": boolean | NativeEncoded }): Promise<void>;
    /** Requires a native export binding before compilation. */
    export function createCalendarEvent(parameters: { "calendar": Entity<"HACalendarAppEntity"> | NativeEncoded; "summary": string | NativeEncoded; "isAllDay": boolean | NativeEncoded; "startDate"?: NativeContent | NativeEncoded; "endDate"?: NativeContent | NativeEncoded; "repeatFrequency": "none" | "yearly" | "monthly" | "weekly" | "daily" | NativeEncoded; "eventDescription"?: string | NativeEncoded; "location"?: string | NativeEncoded }): Promise<string>;
    /** Requires a native export binding before compilation. */
    export function createEventSchema(parameters: { "title": string | NativeEncoded; "startDate": NativeContent | NativeEncoded; "endDate"?: NativeContent | NativeEncoded; "location"?: NativeContent | NativeEncoded; "calendar": Entity<"CalendarSchemaEntity"> | NativeEncoded; "isAllDay": boolean | NativeEncoded; "recurrence"?: NativeContent | NativeEncoded; "attendees": (Entity<"CalendarAttendeeSchemaEntity">)[] | NativeEncoded; "note"?: NativeContent | NativeEncoded }): Promise<Entity<"CalendarEventSchemaEntity">>;
    /** Requires a native export binding before compilation. */
    export function createReminderSchema(parameters: { "title": string | NativeEncoded; "list"?: Entity<"ReminderListSchemaEntity"> | NativeEncoded; "note"?: NativeContent | NativeEncoded; "isFlagged"?: boolean | NativeEncoded; "images": (NativeContent)[] | NativeEncoded; "tags": (string)[] | NativeEncoded; "urls": (NativeContent)[] | NativeEncoded; "dueDate"?: NativeContent | NativeEncoded; "recurrence"?: NativeContent | NativeEncoded; "locationTrigger"?: Entity<"LocationTriggerSchemaEntity"> | NativeEncoded; "section"?: Entity<"ReminderSectionSchemaEntity"> | NativeEncoded }): Promise<Entity<"ReminderSchemaEntity">>;
    /** Requires a native export binding before compilation. */
    export function customWidgetActivate(parameters: { "serverId"?: string | NativeEncoded; "domain"?: string | NativeEncoded; "entityId"?: string | NativeEncoded }): Promise<void>;
    /** Requires a native export binding before compilation. */
    export function customWidgetPerformAction(parameters: { "serverId"?: string | NativeEncoded; "actionId"?: string | NativeEncoded; "payload"?: string | NativeEncoded }): Promise<void>;
    /** Requires a native export binding before compilation. */
    export function customWidgetToggle(parameters: { "serverId"?: string | NativeEncoded; "domain"?: string | NativeEncoded; "entityId"?: string | NativeEncoded; "widgetShowingStates"?: boolean | NativeEncoded }): Promise<void>;
    /** Requires a native export binding before compilation. */
    export function deleteCalendarEvent(parameters: { "calendar": Entity<"HACalendarAppEntity"> | NativeEncoded; "event": Entity<"HACalendarEventAppEntity"> | NativeEncoded; "scope": "thisEvent" | "thisAndFuture" | NativeEncoded }): Promise<string>;
    /** Requires a native export binding before compilation. */
    export function deleteEventSchema(parameters: { "entity": Entity<"CalendarEventSchemaEntity"> | NativeEncoded; "span"?: "this" | "future" | "all" | NativeEncoded }): Promise<void>;
    /** Requires a native export binding before compilation. */
    export function deleteRemindersSchema(parameters: { "entities": (Entity<"ReminderSchemaEntity">)[] | NativeEncoded }): Promise<void>;
    /** Requires a native export binding before compilation. */
    export function fan(parameters: { "fan": Entity<"IntentFanEntity"> | NativeEncoded; "value": boolean | NativeEncoded; "toggle": boolean | NativeEncoded }): Promise<void>;
    /** Native export binding available. */
    export function fireEvent(parameters: { "server": Entity<"IntentServerAppEntity"> | NativeEncoded; "eventName": string | NativeEncoded; "eventData": string | NativeEncoded }): Promise<string>;
    /** Requires a native export binding before compilation. */
    export function focusNameFocusFilter(parameters: { "focusName"?: Entity<"FocusNameAppEntity"> | NativeEncoded }): Promise<void>;
    /** Requires a native export binding before compilation. */
    export function getCalendarEvents(parameters: { "calendar": Entity<"HACalendarAppEntity"> | NativeEncoded; "startDate": NativeContent | NativeEncoded; "endDate": NativeContent | NativeEncoded }): Promise<(Entity<"HACalendarEventAppEntity">)[]>;
    /** Requires a native export binding before compilation. */
    export function getCameraImage(parameters: { "server": Entity<"IntentServerAppEntity"> | NativeEncoded; "camera": Entity<"IntentCameraEntity"> | NativeEncoded }): Promise<NativeContent>;
    /** Requires a native export binding before compilation. */
    export function getEntityState(parameters: { "entity": Entity<"ReadableEntityAppEntity"> | NativeEncoded }): Promise<Entity<"HAEntityStateAppEntity">>;
    /** Requires a native export binding before compilation. */
    export function getReminders(parameters: { "list": Entity<"ReminderListSchemaEntity"> | NativeEncoded; "includeCompleted": boolean | NativeEncoded }): Promise<(Entity<"ReminderSchemaEntity">)[]>;
    /** Requires a native export binding before compilation. */
    export function light(parameters: { "light": Entity<"IntentLightEntity"> | NativeEncoded; "value": boolean | NativeEncoded; "toggle": boolean | NativeEncoded }): Promise<void>;
    /** Requires a native export binding before compilation. */
    export function lockEntity(parameters: { "entity": Entity<"LockAppEntity"> | NativeEncoded }): Promise<void>;
    /** Requires a native export binding before compilation. */
    export function openAppSettings(parameters?: {  }): Promise<void>;
    /** Requires a native export binding before compilation. */
    export function openCloseEntity(parameters: { "action": "open" | "close" | NativeEncoded; "entity": Entity<"OpenableEntityAppEntity"> | NativeEncoded }): Promise<void>;
    /** Requires a native export binding before compilation. */
    export function openEntity(parameters: { "entity"?: Entity<"HAAppEntityAppIntentEntity"> | NativeEncoded }): Promise<void>;
    /** Requires a native export binding before compilation. */
    export function openPage(parameters: { "page"?: Entity<"PageAppEntity"> | NativeEncoded }): Promise<void>;
    /** Requires a native export binding before compilation. */
    export function reloadWidgets(parameters?: {  }): Promise<void>;
    /** Native export binding available. */
    export function renderTemplate(parameters: { "server": Entity<"IntentServerAppEntity"> | NativeEncoded; "template": string | NativeEncoded }): Promise<string>;
    /** Requires a native export binding before compilation. */
    export function resetAllCustomWidgetConfirmation(parameters?: {  }): Promise<void>;
    /** Requires a native export binding before compilation. */
    export function scene(parameters: { "scene": Entity<"IntentSceneEntity"> | NativeEncoded; "showConfirmationNotification": boolean | NativeEncoded; "hapticConfirmation": boolean | NativeEncoded }): Promise<boolean>;
    /** Requires a native export binding before compilation. */
    export function script(parameters: { "script": Entity<"IntentScriptEntity"> | NativeEncoded; "showConfirmationNotification": boolean | NativeEncoded; "hapticConfirmation": boolean | NativeEncoded }): Promise<boolean>;
    /** Requires a native export binding before compilation. */
    export function sendLocation(parameters: { "location": NativeContent | NativeEncoded }): Promise<string>;
    /** Requires a native export binding before compilation. */
    export function setBrightness(parameters: { "light": Entity<"DimmableLightAppEntity"> | NativeEncoded; "brightness": number | NativeEncoded }): Promise<void>;
    /** Requires a native export binding before compilation. */
    export function setTemperature(parameters: { "entity": Entity<"ThermostatAppEntity"> | NativeEncoded; "temperature": number | NativeEncoded }): Promise<void>;
    /** Requires a native export binding before compilation. */
    export function showEntityDetails(parameters: { "target": Entity<"HAAppEntityAppIntentEntity"> | NativeEncoded }): Promise<void>;
    /** Requires a native export binding before compilation. */
    export function switchIntent(parameters: { "entity": Entity<"IntentSwitchEntity"> | NativeEncoded; "value": boolean | NativeEncoded; "toggle": boolean | NativeEncoded }): Promise<void>;
    /** Requires a native export binding before compilation. */
    export function todoItemComplete(parameters: { "serverId": string | NativeEncoded; "listId": string | NativeEncoded; "itemId": string | NativeEncoded; "hapticConfirmation": boolean | NativeEncoded }): Promise<void>;
    /** Requires a native export binding before compilation. */
    export function todoListRefresh(parameters?: {  }): Promise<void>;
    /** Requires a native export binding before compilation. */
    export function turnOnOffEntity(parameters: { "action": "on" | "off" | "toggle" | NativeEncoded; "entity": Entity<"ControllableEntityAppEntity"> | NativeEncoded }): Promise<void>;
    /** Requires a native export binding before compilation. */
    export function updateEventSchema(parameters: { "event": Entity<"CalendarEventSchemaEntity"> | NativeEncoded; "title"?: string | NativeEncoded; "attendees"?: (Entity<"CalendarAttendeeSchemaEntity">)[] | NativeEncoded; "startDate"?: NativeContent | NativeEncoded; "endDate"?: NativeContent | NativeEncoded; "isAllDay"?: boolean | NativeEncoded; "calendar"?: Entity<"CalendarSchemaEntity"> | NativeEncoded; "recurrence"?: NativeContent | NativeEncoded; "note"?: string | NativeEncoded; "location"?: NativeContent | NativeEncoded; "span"?: "this" | "future" | "all" | NativeEncoded }): Promise<Entity<"CalendarEventSchemaEntity">>;
    /** Requires a native export binding before compilation. */
    export function updateReminderSchema(parameters: { "target": Entity<"ReminderSchemaEntity"> | NativeEncoded; "title"?: string | NativeEncoded; "note"?: NativeContent | NativeEncoded; "tags"?: (string)[] | NativeEncoded; "urls"?: (NativeContent)[] | NativeEncoded; "dueDate"?: NativeContent | NativeEncoded; "recurrence"?: NativeContent | NativeEncoded; "isCompleted"?: boolean | NativeEncoded; "isFlagged"?: boolean | NativeEncoded; "list"?: Entity<"ReminderListSchemaEntity"> | NativeEncoded; "locationTrigger"?: Entity<"LocationTriggerSchemaEntity"> | NativeEncoded }): Promise<Entity<"ReminderSchemaEntity">>;
    /** Requires a native export binding before compilation. */
    export function updateSensors(parameters?: {  }): Promise<string>;
    /** Requires a native export binding before compilation. */
    export function updateWidgetItemConfirmationState(parameters: { "widgetId"?: string | NativeEncoded; "serverUniqueId"?: string | NativeEncoded; "confirmsTapAction"?: boolean | NativeEncoded }): Promise<void>;
    /** Requires a native export binding before compilation. */
    export function widgetAreas(parameters: { "server": Entity<"IntentServerAppEntity"> | NativeEncoded }): Promise<void>;
    /** Requires a native export binding before compilation. */
    export function widgetAreasPage(parameters: { "serverId"?: string | NativeEncoded; "familyRawValue"?: number | NativeEncoded; "step"?: number | NativeEncoded; "pageCount"?: number | NativeEncoded }): Promise<void>;
    /** Requires a native export binding before compilation. */
    export function widgetCalendar(parameters: { "calendars"?: (Entity<"WidgetCalendarAppEntity">)[] | NativeEncoded; "showsCalendarName": boolean | NativeEncoded }): Promise<boolean>;
    /** Requires a native export binding before compilation. */
    export function widgetCalendarRefresh(parameters?: {  }): Promise<void>;
    /** Requires a native export binding before compilation. */
    export function widgetCommonlyUsedEntities(parameters: { "server": Entity<"IntentServerAppEntity"> | NativeEncoded; "showLastUpdateTime": boolean | NativeEncoded; "showStates": boolean | NativeEncoded; "includedDomains"?: (Entity<"WidgetDomainAppEntity">)[] | NativeEncoded; "excludedDomains"?: (Entity<"WidgetDomainAppEntity">)[] | NativeEncoded }): Promise<void>;
    /** Requires a native export binding before compilation. */
    export function widgetCustom(parameters: { "widget"?: Entity<"CustomWidgetEntity"> | NativeEncoded; "showLastUpdateTime": boolean | NativeEncoded; "showStates": boolean | NativeEncoded }): Promise<void>;
    /** Requires a native export binding before compilation. */
    export function widgetDetails(parameters: { "source": "entity" | "complication" | "template" | NativeEncoded; "server": Entity<"IntentServerAppEntity"> | NativeEncoded; "entity"?: Entity<"HAAppEntityAppIntentEntity"> | NativeEncoded; "attribute"?: Entity<"WidgetDetailsAttributeAppEntity"> | NativeEncoded; "complication"?: Entity<"WidgetRectangularComplicationAppEntity"> | NativeEncoded; "upperTemplate": string | NativeEncoded; "lowerTemplate": string | NativeEncoded; "detailsTemplate": string | NativeEncoded; "runScript": boolean | NativeEncoded; "script"?: Entity<"IntentScriptEntity"> | NativeEncoded; "showConfirmationNotification": boolean | NativeEncoded }): Promise<void>;
    /** Requires a native export binding before compilation. */
    export function widgetEnergy(parameters: { "server": Entity<"IntentServerAppEntity"> | NativeEncoded; "source": "auto" | "consumption" | "solar" | "battery" | "gas" | NativeEncoded; "period": "today" | "yesterday" | "thisWeek" | "thisMonth" | NativeEncoded }): Promise<void>;
    /** Requires a native export binding before compilation. */
    export function widgetEnergyRefresh(parameters?: {  }): Promise<void>;
    /** Requires a native export binding before compilation. */
    export function widgetEntities(parameters: { "server": Entity<"IntentServerAppEntity"> | NativeEncoded; "entities"?: (Entity<"WidgetEntitiesAppEntity">)[] | NativeEncoded; "showLastUpdateTime": boolean | NativeEncoded }): Promise<void>;
    /** Requires a native export binding before compilation. */
    export function widgetGauge(parameters: { "source": "entity" | "complication" | "template" | NativeEncoded; "gaugeType": "normal" | "singleLabel" | "capacity" | NativeEncoded; "server": Entity<"IntentServerAppEntity"> | NativeEncoded; "entity"?: Entity<"HAAppEntityAppIntentEntity"> | NativeEncoded; "attribute"?: Entity<"WidgetGaugeAttributeAppEntity"> | NativeEncoded; "complication"?: Entity<"WidgetCircularComplicationAppEntity"> | NativeEncoded; "minValue": number | NativeEncoded; "maxValue": number | NativeEncoded; "valueTemplate": string | NativeEncoded; "valueLabelTemplate": string | NativeEncoded; "labelTemplate": string | NativeEncoded; "minTemplate": string | NativeEncoded; "maxTemplate": string | NativeEncoded; "runScript": boolean | NativeEncoded; "script"?: Entity<"IntentScriptEntity"> | NativeEncoded; "showConfirmationNotification": boolean | NativeEncoded }): Promise<void>;
    /** Requires a native export binding before compilation. */
    export function widgetRefresh(parameters: { "widgetKind"?: string | NativeEncoded }): Promise<void>;
    /** Requires a native export binding before compilation. */
    export function widgetScripts(parameters: { "scripts"?: (Entity<"IntentScriptEntity">)[] | NativeEncoded; "showConfirmationDialog": boolean | NativeEncoded }): Promise<boolean>;
    /** Requires a native export binding before compilation. */
    export function widgetSensors(parameters: { "server"?: Entity<"IntentServerAppEntity"> | NativeEncoded; "sensors"?: (Entity<"IntentSensorsAppEntity">)[] | NativeEncoded }): Promise<void>;
    /** Requires a native export binding before compilation. */
    export function widgetTodoList(parameters: { "server"?: Entity<"IntentServerAppEntity"> | NativeEncoded; "list"?: Entity<"TodoListAppEntity"> | NativeEncoded }): Promise<boolean>;
  }
}
