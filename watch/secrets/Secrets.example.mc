// Copy this file to source/Secrets.mc (gitignored) and paste your token.
// Get one in GRIND: Profile -> Settings -> Watch -> Generate token.
// It lives outside source/ so the compiler doesn't see two Secrets modules.
// (:background): the background day sync (Bg.mc) sends with these too.
(:background)
module Secrets {
    const API_BASE = "https://grindtrack.vercel.app/api/watch/v1";
    const TOKEN = "gwt_PASTE_YOUR_64_HEX_CHAR_TOKEN_HERE";
}
