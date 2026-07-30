# Local Fonts

Load fonts from a folder in your vault and apply them to text, interface, monospace,
headings and emoji. Works on desktop and mobile, and makes no network requests.

## How it works

Point the plugin at a folder and it reads every `.ttf`, `.otf`, `.woff` and `.woff2` file
inside, including subfolders. Family name, weight, style, script coverage and colour
format all come from the font file itself, so filenames are irrelevant in normal use.

Fonts load through resource URLs instead of base64, so the browser fetches only the
weights a note actually displays. A folder holding forty faces typically loads a dozen.

The folder can be hidden. `.fonts` is the default, which keeps a font collection out of
your note tree.

## Adding fonts

Drop files into the folder, then open Settings → Local Fonts. Families appear in the
dropdowns after the folder is scanned. Scanning runs in the background, and only files
that changed since last time are read again.

Filenames matter in one situation. When a `.woff2` cannot be decoded, the plugin looks
for a file with the same name and a different extension and reads metadata from that
instead. Keeping `foo.woff2` and `foo.ttf` named alike preserves that fallback.

You can keep the same face in several formats. The plugin picks one per platform,
preferring a format the current engine can render, then woff2 over woff over otf over
ttf, then the smaller file.

## Settings

**Fonts folder** takes a vault-relative path.

**Text**, **Interface**, **Monospace** and **Headings** each take a family from the fonts
you have, or leave the theme alone.

**Emoji** sits first in every font stack and covers only emoji code points, so it leaves
digits and punctuation to the family you chose for that role.

**Hard override** forces your fonts with `!important` for themes that set `font-family`
directly instead of using Obsidian's variables. Icon elements stay untouched.

## Diagnostics

Every family gets a card listing the weights it has, the scripts it covers, and the
operating systems that can render it. Each face shows its format, file size, colour
format, and whether the plugin selected it for this device.

The **Check** button measures what actually rendered on the device you are using. Reach
for it after changing fonts, especially on a phone.

## Emoji formats

Colour emoji fonts come in incompatible flavours, and the two engines Obsidian runs on
cover different ones. Chromium, which powers desktop and Android, renders COLRv1 and
ignores OT-SVG. WebKit on iOS renders both.

One file often cannot serve every platform. Put more than one build of the same emoji
family in the folder and the plugin chooses per device. The card reports which build it
picked.

Google's Noto Color Emoji ships as a COLRv1 `.woff2`, an OT-SVG build, and a 25 MB `.ttf`
carrying both. Any combination of those works.

## Limitations

The desktop test suite runs against Obsidian 1.0.3 and the latest stable release.
Android has no automated coverage yet, and none is available for iOS. On those platforms
the Check button is how you confirm a font applied.

Emoji on iOS depend on which colour formats your files carry. When they fail, the card
shows which format is missing.

## Installation

The plugin is not in Obsidian's community browser yet. To install it by hand:

1. Download `main.js`, `manifest.json` and `styles.css` from the
   [latest release](https://github.com/flowing-abyss/obsidian-local-fonts/releases).
2. Create a `local-fonts` folder inside your vault's `.obsidian/plugins/` directory and
   put those three files in it.
3. Restart Obsidian and enable **Local Fonts** under Settings → Community plugins.

[BRAT](https://github.com/TfTHacker/obsidian42-brat) can install and update it from this
repository directly.

## License

[MIT](LICENSE)
