# Templates

A template gives a new project a starting structure: output size, variables, graphics, the cards around the video and a rule that puts a graphic on a section by name. Everything it creates is ordinary project data (`definition`), so after creation the project can be edited freely and the template is no longer involved.

There are two kinds:

- **Built-in templates**, defined in `src/domain/templates.ts` (`initializeDefaultTemplates`).
- **Saved templates**, made from an existing project with "Tallenna pohjaksi" (Lähde step, Projektin tiedot). They live in the `UserTemplate` table.

Choose one in the new-project dialog ("Pohja"). "Tyhjä projekti" (key `basic`) creates a project with no structure.

## Built-in templates

All content follows the Evangelical Lutheran Church of Finland: the order of the Mass from the church handbook, the Gospel as its own section, and the Aaronic blessing on the closing card.

| Key | Name | Output | Sections | Graphics |
|---|---|---|---|---|
| `sermon` | Saarna | YouTube 1080p, target 15 min | Evankeliumi, Saarna | opening card, Gospel lower third, closing card, caption style |
| `liturgy` | Messu | YouTube 1080p | Alkuvirsi … Loppuvirsi (17 sections in the order of the Mass) | as `sermon` |
| `vespers` | Iltahartaus | YouTube 1080p | Alkuvirsi, Psalmi, Raamatunluku, Hartaus, Rukous, Isä meidän, Siunaus, Loppuvirsi | opening card, closing card, caption style |
| `short-vertical` | Lyhyt pystyvideo | YouTube Shorts 1080x1920, target 60 s, reframe `fill` | Ote saarnasta | opening card, caption style |

## What applying a template does

`applyTemplate` (`src/domain/templates.ts`) returns a `ProjectDefinition`:

- `template`: width, height, preset, fps, target length, reframe, colours from the theme.
- `variables`: the template's variable names. `otsikko` is the project title, `saarnaaja` the preacher and `evankeliumi` the Gospel reference when those were given; the rest start empty. Graphics refer to them as `{{name}}`.
- `graphics`: built from the template's graphic specs in the theme's colours and font, on the 1920x1080 design canvas. Fresh ids on every application.
- `composition.items`: the opening card first and the closing card last, as standalone slates.
- `template.endingGraphicId`: marks the closing slate. `addSourceSection` inserts new clips before it while it is still the last base item, so sections added later never land after it.
- `template.sectionOverlays`: rules `{ section, graphicId, durationSeconds }`. When a section whose name matches (case-insensitive) is added, an overlay with that graphic is anchored to it for at most that long (the Gospel lower third on "Evankeliumi").
- `template.sectionNames`: the suggested section names; the Structure step offers them as the button "Pohjan osiot".

The create route (`POST /api/projects`) applies the template by `templateKey` (built-in) or `userTemplateId` (saved). An unknown `templateKey` creates a blank project, as before.

## Saving a project as a template

`captureTemplate` (`src/domain/saved-templates.ts`) keeps output settings, graphics, variable names (values cleared), podcast settings, standalone slates and one section-overlay rule per overlay a person placed on a section. It drops sources, sections with their ranges, clips, overlays and voiceover mixes that sit at a time position. A standalone slate after the last clip becomes the ending slate.

`applySavedTemplate` gives the copy fresh graphic ids, keeps every graphic reference consistent and fills variables the same way as a built-in template.

Template names are unique (409 on a duplicate). Deleting a template does not change projects made from it.

## Adding a built-in template

Add it to `initializeDefaultTemplates()`:

```ts
registry.registerTemplate(templateDefinitionSchema.parse({
  themeKey: "default",
  key: "funeral",
  name: "Hautausmessu",
  description: "Hautausmessun tallenne",
  sections: ["Alkuvirsi", "Evankeliumi", "Muistopuhe", "Siunaus"],
  variables: ["otsikko"],
  output: { presetKey: "youtube-1080p", fps: 30 },
  graphics: [opening, ending, captions],
  opening: { graphic: "opening", durationSeconds: 4 },
  ending: { graphic: "ending", durationSeconds: 5 },
  sectionOverlays: [],
}));
```

`registerTemplate` throws when the theme, an output preset (`OUTPUT_PRESETS`) or a graphic key used by `opening`, `ending` or `sectionOverlays` does not exist. Graphic specs have three kinds: `title-card` (full-frame title and subtitle), `lower-third` (text bar near the bottom, transparent background) and `caption-style` (see "Burned-in captions" in `CLAUDE.md`). Texts may contain `{{variable}}` tokens.

A theme (`Theme`: colours, typography, optional assets) is registered with `registry.registerTheme(...)` and shared by templates. The built-in theme uses the DejaVu Sans font that the renderer already bundles.

## API

- `GET /api/templates`: `{ templates: [...] }`, built-in ones (`kind: "builtin"`, `key`) then saved ones (`kind: "saved"`, `id`), each with `name`, `description`, `sections`, `presetKey`, `targetSeconds`.
- `POST /api/templates` `{ projectId, name, description? }`: saves the project as a template (201, 404 unknown project, 409 duplicate name).
- `DELETE /api/templates/{id}`: deletes a saved template (404 when unknown).
- `POST /api/projects` accepts `templateKey` or `userTemplateId` (404 when the saved template does not exist).

## Tests

Unit: `src/domain/templates.test.ts`, `src/domain/saved-templates.test.ts`. End to end: `e2e/templates.e2e.test.ts` (creation from each kind, a render with opening card, clips and closing card, save, reuse, duplicate name, delete).
