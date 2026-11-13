# Third-party notices

Mantel bundles the assets below. Each is redistributable under the licence named,
and the original terms continue to apply to that asset regardless of Mantel's own licence.

## Fonts — `static/fonts/`

All four families are released under the **SIL Open Font License 1.1**, which permits
redistribution as part of a larger work.

| Font | Author | Licence |
|---|---|---|
| Caveat | Impallari Type | SIL OFL 1.1 |
| IBM Plex Mono | IBM | SIL OFL 1.1 |
| Kalam | Indian Type Foundry | SIL OFL 1.1 |
| Libre Baskerville | Impallari Type / Rodrigo Fuenzalida | SIL OFL 1.1 |

The full licence text, with each family's copyright line, ships alongside the
fonts in [`static/fonts/OFL.txt`](static/fonts/OFL.txt), as the OFL requires.

## Surface textures — `static/textures/instant/`

Prepared by `scripts/build-instant-surfaces.mjs` from **CC0 / public domain** scans
published by [ambientCG](https://ambientcg.com) and [Poly Haven](https://polyhaven.com).
CC0 imposes no attribution requirement; the credit here is given as a courtesy.

## Map and globe imagery

| Asset | Source | Status |
|---|---|---|
| Globe textures (twelve months) | NASA Blue Marble | Public domain |
| Night lights | NASA Black Marble | Public domain |
| Vector coastlines and borders | [Natural Earth](https://www.naturalearthdata.com) | Public domain |

NASA imagery is not subject to copyright in the United States. NASA does not endorse
this project, and its logos and insignia are not used.

## Optional runtime data sources

These are fetched at runtime only when the matching widget is enabled. They are not
bundled with Mantel, and each user is responsible for complying with the provider's terms.

| Source | Terms |
|---|---|
| Trafiklab / SL departures | Requires the user's own API key and provider attribution; attribution is displayed by the widget |
| Wikipedia place descriptions | CC BY-SA; the article is linked in the overlay |
| Home Assistant weather | The user's own Home Assistant instance |
| Immich | The user's own Immich server, reached over its HTTP API |

## Photographs in the documentation — `docs/media/`

The screenshots and the animated demo show a throwaway demo library, never
anyone's real photos. Every image in them is **CC0 or public domain**, from
[Wikimedia Commons](https://commons.wikimedia.org). Attribution is not required
by those terms and is given as a courtesy.

| Image | Author | Status |
|---|---|---|
| Hamnøy, Moskenesøya, Lofoten Islands, Norway | Stch2022 | CC0 |
| Café in Paris | Nicolas Vigier | CC0 |
| Country house, Tuscany | Marsel Minga | CC0 |
| Bishamondō and Daigo-ji, Kyoto | lumoplank | CC0 |
| Hiking in the Italian Alps | Philipp Schlabs | CC0 |
| Amsterdam canal houses | Kaci Baum | CC0 |
| *Summer Sunset over the Archipelago* (1897), Eugène Jansson | photograph by Gotogo | Public domain |
| *Veduta del Canal Grande dalla Punta della Dogana*, Bernardo Bellotto | photograph by Didier Descouens | Public domain |

The place names, dates and people shown over these photographs are invented
demo metadata, not data read from any real library.

## Relationship to Immich

Mantel is an independent project. It communicates with Immich only through Immich's
public HTTP API and contains no Immich source code, so it is not a derivative work of
Immich. "Immich" is the name of that project and is used here descriptively; Mantel is
not affiliated with or endorsed by the Immich project.
