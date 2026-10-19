"""Deterministic category/function names for the metadata-only action catalog."""
import hashlib
import re
import unicodedata
from collections import Counter


def words(value):
    value = unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode()
    value = re.sub(r'([a-z0-9])([A-Z])', r'\1 \2', value)
    return re.findall(r'[A-Z]+(?=[A-Z][a-z]|\b)|[A-Z]?[a-z]+|[0-9]+', value)


def pascal(value):
    result = ''.join(w[0].upper() + w[1:] for w in words(value)) or 'Action'
    return 'Action' + result if result[0].isdigit() else result


def camel(value):
    tokens = words(value)
    result = tokens[0].lower() + ''.join(w[0].upper() + w[1:] for w in tokens[1:]) if tokens else 'action'
    return 'action' + result if result[0].isdigit() else result


# App aliases combine desktop/mobile bundles into the same useful category.
APP_GROUPS = {
    'LLM': 'generativeassistanttools gms WritingTools',
    'Images': 'GenerativePlaygroundApp',
    'Photos': '-Photos-AppIntents Photos mobileslideshow',
    'Contacts': 'AddressBook MobileAddressBook contacts PeopleViewService',
    'Calendar': 'iCal mobilecal',
    'Notes': 'Notes mobilenotes',
    'Reminders': 'reminders',
    'Safari': 'Safari mobilesafari',
    'Settings': 'Settings Preferences systempreferences Desktop-Settings NanoSettings',
    'Accessibility': 'UniversalAccess HearingApp TransparencySettingsIntents',
    'Shortcuts': 'ShortcutsActions shortcuts',
    'Messages': 'MobileSMS',
    'Mail': 'mail',
    'Phone': 'calls mobilephone',
    'Wallet': 'Passbook PassbookStub',
    'Clock': 'clock mobiletimer-framework',
    'Books': 'iBooks iBooksX',
    'Files': 'finder DocumentManagerUICore',
    'Music': 'Music MediaRemoteAppIntentsExtension',
    'TVRemote': 'TVRemoteUIService TVRemoteApp',
    'Watch': 'Bridge PBBridgeSupport',
    'Health': 'HealthStandaloneIntents',
    'Focus': 'donotdisturb',
    'Windows': 'WindowManager AppKit',
    'Numbers': 'calculator',
}
APP_CATEGORIES = {app: category for category, apps in APP_GROUPS.items() for app in apps.split()}

# Native workflow actions predate app intents and need semantic categories.
WORKFLOW_GROUPS = {
    'LLM': 'askllm',
    'Text': 'gettext correctspelling detectlanguage dictatetext gethtmlfromrichtext getmarkdownfromrichtext getrichtextfromhtml getrichtextfrommarkdown getselectedtext getnameofemoji showdefinition detect.text',
    'Numbers': 'number math calculateexpression round statistics detect.number format.number',
    'Clipboard': 'getclipboard setclipboard',
    'Lists': 'list additemtolist choosefromlist count getitemfromlist',
    'Dictionary': 'dictionary getvalueforkey setvalueforkey detect.dictionary',
    'Dates': 'date adjustdate converttimezone gettimebetweendates detect.date format.date',
    'Files': 'file airdropdocument connecttoservers ejectdisk getparentdirectory gettypeaction makediskimage mountdiskimage makezip unzip openin print previewdocument format.filesize',
    'PDF': 'compresspdf makepdf gettextfrompdf makeimagefrompdfpage splitpdf',
    'Images': 'addframetogif avairyeditphoto extracttextfromimage generatebarcode getframesfromimage giphy makegif makeimagefromrichtext overlayimageonimage overlaytext scanbarcode detect.images',
    'Photos': 'deletephotos getlastphoto getlastscreenshot getlastvideo getlatestbursts getlatestlivephotos getlatestphotoimport removefromalbum savetocameraroll selectphoto takephoto takescreenshot takevideo',
    'Music': 'addmusictoupnext addtoplaylist clearupnext createplaylist exportsong getcurrentsong handoffplayback importaudiofiles pausemusic playmusic seek setplaybackdestination skipback skipforward get.playlist',
    'Audio': 'recordaudio playsound speaktext makespokenaudiofromtext setvolume shazamMedia',
    'Video': 'encodemedia makevideofromgif trimvideo',
    'Podcasts': 'getepisodesforpodcast getpodcastsfromlibrary playpodcast searchpodcasts',
    'Calendar': 'addnewcalendar addnewevent getupcomingevents removeevents showincalendar',
    'Reminders': 'addnewreminder addquickreminder getupcomingreminders removereminders',
    'Notes': 'appendnote shownote',
    'Contacts': 'addnewcontact contacts phonenumber selectcontacts selectemail selectphone detect.contacts detect.phonenumber',
    'Mail': 'email sendemail detect.emailaddress',
    'Messages': 'sendmessage',
    'Maps': 'address getcurrentlocation getdirections getdistance gethalfwaypoint getmapslink getparkedcarlocation gettraveltime location searchlocalbusinesses searchmaps setparkedcar showinblindsquare detect.address',
    'Web': 'downloadurl getarticle geturlcomponent getwebpagecontents openurl openxcallbackurl readinglist searchweb showwebpage url urlencode detect.link',
    'Home': 'gethomeaccessorystate homeaccessory intercom',
    'Apps': 'getcurrentapp openapp returntohomescreen runextension searchappstore splitscreen',
    'Windows': 'movewindow resizewindow',
    'Scripting': 'runapplescript runjavascriptforautomation runjavascriptonwebpage runshellscript runsshscript watchmedo',
    'Shortcuts': 'getmyworkflows handoff runworkflow',
    'Variables': 'appendvariable getvariable setvariable',
    'Storage': 'deletestoredcontent getstoredcontent setstoredcontent',
    'Interaction': 'alert ask notification showresult share viewresult',
    'Flow': 'comment delay dismisssiri exit input nothing output waittoreturn',
    'Encoding': 'base64encode hash',
    'Network': 'getipaddress getwifi setairdropreceiving',
    'System': 'appearance displaysleep flashlight getbatterylevel getclassaction getdevicedetails getitemname getitemtype lockscreen logout openpasswords reboot setbrightness setitemname sleep spotlightsearch startscreensaver vibrate',
    'Store': 'searchitunes showinstore',
    'Social': 'postonfacebook tweet',
}
WORKFLOW_CATEGORIES = {identifier: category for category, ids in WORKFLOW_GROUPS.items() for identifier in ids.split()}
PREFIX_CATEGORIES = {
    'text': 'Text', 'image': 'Images', 'number': 'Numbers', 'file': 'Files',
    'documentpicker': 'Files', 'finder': 'Files', 'url': 'Web', 'rss': 'Web',
    'dnd': 'Focus', 'timer': 'Clock', 'workout': 'Health', 'health': 'Health',
    'posters': 'Wallpaper', 'wallpaper': 'Wallpaper', 'personalhotspot': 'Network',
    'vpn': 'Network', 'wifi': 'Network', 'bluetooth': 'Network',
    'airplanemode': 'Network', 'cellulardata': 'Network', 'measurement': 'Measurements',
    'display': 'System', 'hide': 'Apps', 'lock': 'Apps', 'quit': 'Apps',
    'announcenotifications': 'Settings', 'listeningmode': 'Audio',
    'lowpowermode': 'System', 'nightshift': 'System', 'orientationlock': 'System',
    'silenceunknowncallers': 'Phone', 'stagemanager': 'Windows', 'truetone': 'System',
}
CONTENT_CATEGORIES = {
    'apps': 'Apps', 'articles': 'Web', 'calendarevents': 'Calendar', 'contacts': 'Contacts',
    'displays': 'System', 'eventattendees': 'Calendar', 'files': 'Files', 'health': 'Health',
    'images': 'Images', 'locations': 'Maps', 'music': 'Music', 'notes': 'Notes',
    'photos': 'Photos', 'reminders': 'Reminders', 'vpns': 'Network', 'windows': 'Windows',
    'appstore': 'Store', 'itunesartist': 'Store', 'itunesstore': 'Store',
    'parkedcar': 'Maps', 'podcast': 'Podcasts', 'podcastshow': 'Podcasts',
    'safariwebpage': 'Safari', 'shazam': 'Audio', 'weather': 'Weather', 'workflow': 'Shortcuts',
}

# Pin concise names for common operations. Return types come from action-results.json.
METHODS = {
    'askllm': 'ask', 'gettext': 'create',
    'text.replace': 'replace', 'text.split': 'split',
    'text.combine': 'join', 'text.match': 'match',
    'text.changecase': 'changeCase', 'text.trimwhitespace': 'trim',
    'number': 'create', 'math': 'calculate',
    'getclipboard': 'get', 'setclipboard': 'set',
    'dictionary': 'create', 'getvalueforkey': 'get', 'setvalueforkey': 'set',
    'list': 'create', 'getitemfromlist': 'get',
}


def category_for(identifier):
    # macOS also exposes Writing Tools through AppKit, alongside window actions.
    if identifier.startswith('com.apple.AppKit.') and any(
            token in identifier for token in ('WritingTools', 'Intelligence')):
        return 'LLM'
    if identifier.startswith('is.workflow.actions.'):
        short = identifier.removeprefix('is.workflow.actions.')
        if short in WORKFLOW_CATEGORIES:
            return WORKFLOW_CATEGORIES[short]
        parts = short.split('.')
        if parts[0] in ('filter', 'properties', 'setters', 'detect') and len(parts) > 1:
            return CONTENT_CATEGORIES.get(parts[1], pascal(parts[1]))
        return PREFIX_CATEGORIES.get(parts[0], pascal(parts[0]) if len(parts) > 1 else 'System')
    parts = identifier.split('.')
    app = parts[2] if identifier.startswith('com.apple.') and len(parts) > 2 else '.'.join(parts[:-1])
    return APP_CATEGORIES.get(app, pascal(app))


def assign_functions(actions):
    candidates = []
    for action in actions:
        short = action['id'].removeprefix('is.workflow.actions.')
        method, result = METHODS.get(short, camel(action['name'])), None
        candidates.append((category_for(action['id']), method, result))
    counts = Counter((category, method) for category, method, _ in candidates)
    source_counts = Counter((category, method, action['id'].split('.')[2])
                            for action, (category, method, _) in zip(actions, candidates))
    native_winners = {}
    for action, (category, method, _) in zip(actions, candidates):
        if action['id'].startswith('is.workflow.actions.'):
            key = (category, method)
            old = native_winners.get(key)
            if old is None or (len(action['id']), action['id']) < (len(old), old):
                native_winners[key] = action['id']
    used = set()
    for action, (category, method, result) in zip(actions, candidates):
        # Native actions keep concise names; app variants carry their bundle/intent
        # name when display names collide. No suffix depends on input ordering.
        if counts[category, method] > 1 and native_winners.get((category, method)) != action['id']:
            parts = action['id'].split('.')
            suffix = parts[2]
            if source_counts[category, method, suffix] > 1:
                suffix += '.' + parts[-1]
            method += 'From' + pascal(suffix)
        key = (category, method)
        if key in used:
            method += hashlib.sha256(action['id'].encode()).hexdigest()[:10]
        used.add((category, method))
        action['category'] = category
        action['functionName'] = method
        action.pop('resultType', None)
        if result:
            action['resultType'] = result
