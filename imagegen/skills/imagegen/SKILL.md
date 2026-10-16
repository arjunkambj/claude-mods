---
name: imagegen
description: Generate or edit raster images by delegating to the Codex CLI's built-in image_gen tool (runs on the user's Codex/ChatGPT subscription, no API key), when the task benefits from AI-created bitmap visuals such as photos, illustrations, textures, sprites, mockups, hero images, or transparent-background cutouts. Use when the user asks to create a new image, transform an existing image file, or derive visual variants from reference images, and the output should be a bitmap asset rather than code or vector. Do not use when the task is better handled by editing existing SVG/vector/code-native assets, extending an established icon or logo system, or building the visual directly in HTML/CSS/canvas.
---

# Image Generation via Codex

Generates or edits images for the current project (website assets, game assets, UI mockups, product mockups, wireframes, logo exploration, photorealistic images, infographics).

Claude has no image generator of its own. This skill hands each image to the Codex CLI (`codex exec`), whose built-in `image_gen` tool runs on the user's Codex subscription. No `OPENAI_API_KEY` is used or needed. Claude writes the prompt spec, runs the wrapper, then inspects and places the results.

## Requirements

- `codex` on PATH and logged in (`codex login` with the ChatGPT account). If `codex exec` fails with an auth error, tell the user to run `codex login` themselves; do not try to log in for them.
- Image generation counts against the user's Codex plan limits. If Codex reports a usage limit, stop and tell the user; do not switch to another provider or the paid API.

## The wrapper

If the `image` tool from the imagegen mod is available (`mcp__imagegen__image`), call it instead of running the wrapper through Bash: it takes the same inputs (`spec`, `output` or `outputDir`, `inputs`, `count`, `overwrite`), shows the finished images to the user in the chat, and returns the saved paths. Everything below about specs, checking and placement still applies. Use the wrapper only when that tool is missing.

```bash
IMAGEGEN="<this skill's base directory>/scripts/codex_image.sh"

"$IMAGEGEN" -p "<spec>" -o public/images/hero.png           # one image
"$IMAGEGEN" -p "<spec>" -n 3 -o scratch/logo.png            # 3 variants: logo-1.png … logo-3.png
"$IMAGEGEN" -f spec.txt -d scratch/drafts                   # spec from file, image_1.png …
"$IMAGEGEN" -i photo.png -p "<edit spec>" -o photo-edited.png   # edit an image
"$IMAGEGEN" -i target.png -i style.png -p "<spec>" -o out.png   # several inputs, order matters
```

- `-p` / `-f`: the full image spec (see Prompt schema). It is passed verbatim to `image_gen`.
- `-i`: attach an input image (repeatable). The spec must say each image's role by index.
- `-n`: variants of the same spec. Distinct assets need separate runs with their own specs.
- `-o` file or `-d` dir: where to copy results. Without either, it prints the paths under `~/.codex/generated_images/`.
- `--force` overwrites existing files; without it the wrapper refuses and names the Codex source path.
- `--effort`: Codex reasoning effort (default `low`; the image tool does the real work).

It prints one destination path per line. Each image takes roughly 40–80 seconds, so give the Bash call a `timeout` of 600000. For several distinct assets, run separate wrapper calls in parallel (multiple Bash calls in one message, or `run_in_background`) rather than one after another.

The wrapper runs Codex in a throwaway directory with a read-only sandbox and tells it not to run commands, so Codex never touches the project. Claude does all file placement.

## Rules

- Never call the OpenAI Image API or any other image provider; every image goes through `codex_image.sh`.
- Do not modify `scripts/codex_image.sh` during a task. If it misbehaves, report the error and ask.
- Do not overwrite an existing asset unless the user asked for replacement; write a sibling versioned name such as `hero-v2.png` or `item-icon-edited.png`.
- For large requests (more than ~5 images), state the count before running, since they use the user's plan quota.
- Edit inputs must be files on disk. If the user pasted an image into chat without a path, ask for the file path.

## Output locations

- Preview or brainstorming: write to the session scratchpad directory (or `/tmp/imagegen/` if there is none).
- Project-bound assets: write straight to the project's asset location (for example `public/images/`) or the user-named path, and update any code that references the file. Never leave a project-referenced asset only under `~/.codex/generated_images/`.
- Delete scratch spec files when done.

## Checking results

- Open every output with the Read tool and check subject, style, composition, text accuracy, and each invariant or avoid item before reporting success.
- For transparent assets, run `python3 "<this skill's base directory>/scripts/alpha_report.py" out.png` and confirm it says `transparent background` with clear corners. Subjects often come back at alpha ~253, which counts as solid.
- Check pixel size when it matters: `sips -g pixelWidth -g pixelHeight out.png`.
- Surface the chosen image to the user (for example with SendUserFile when available) rather than only naming the path.

## When to use
- Generate a new image (concept art, product shot, cover, website hero)
- Generate a new image using one or more reference images for style, composition, or mood
- Edit an existing image (inpainting, lighting or weather changes, background replacement, object removal, compositing, transparent background)
- Produce many assets or variants for one task

## When not to use
- Extending or matching an existing SVG/vector icon set, logo system, or illustration library inside the repo
- Simple shapes, diagrams, wireframes, or icons better produced directly in SVG, HTML/CSS, or canvas
- A small edit to a project-local asset that already exists in an editable native format
- Any task where the user clearly wants deterministic code-native output instead of a generated bitmap

## Decision tree

1. **Intent:**
   - Modify an existing image while preserving parts of it → edit: attach it with `-i` as `Image 1: edit target` and list invariants.
   - Images given only as style, composition, mood, or subject guidance → generate with references: attach them and label each `reference`.
   - No images → generate.
2. **Execution:** one asset → one run; variants of one spec → `-n`; many distinct assets → one run per asset, in parallel.

Assume the user wants a new image unless they clearly ask to change an existing one.

## Workflow
1. Decide intent, and whether the output is preview-only or project-bound.
2. Collect inputs up front: request, exact text (verbatim), constraints/avoid list, input images and their roles.
3. If the user asked for a photo, illustration, sprite, product image, banner, or other raster asset, generate it rather than substituting SVG/HTML/CSS placeholders. If the request is an icon, logo, or UI graphic that should match existing repo-native vector assets, edit those directly instead.
4. Write the spec per the specificity policy below. Put orientation/aspect ratio and transparency in the spec text; the tool has no size or background parameters.
5. Run the wrapper with the destination path.
6. Read and validate the outputs.
7. Iterate with one targeted change at a time, repeating invariants in every edit spec. To refine a result, attach it with `-i` as the edit target.
8. Update references in code, delete scratch files.
9. Report the final saved path(s) and the final spec(s) used.

## Prompt augmentation

Turn the user's request into a structured, production-oriented spec. Make the goal clearer and more actionable, but do not blindly add detail.

### Specificity policy

- If the prompt is already specific and detailed, preserve that specificity and only normalize/structure it.
- If the prompt is generic, add tasteful augmentation only when it materially improves the result.

Allowed: composition or framing hints, polish level or intended-use hints, practical layout guidance, reasonable scene concreteness that supports the request.

Not allowed: extra characters or objects not implied by the request; brand names, slogans, palettes, or narrative beats not implied; arbitrary side-specific placement unless the surrounding layout supports it.

## Use-case taxonomy (exact slugs)

Generate:
- photorealistic-natural — candid/editorial lifestyle scenes with real texture and natural lighting.
- product-mockup — product/packaging shots, catalog imagery, merch concepts.
- ui-mockup — app/web interface mockups and wireframes; specify the desired fidelity.
- infographic-diagram — diagrams/infographics with structured layout and text.
- scientific-educational — classroom explainers, scientific diagrams, learning visuals with required labels and accuracy constraints.
- ads-marketing — campaign concepts and ad creatives with audience, brand position, scene, and exact tagline/copy.
- productivity-visual — slide, chart, workflow, and data-heavy business visuals.
- logo-brand — logo/mark exploration, vector-friendly.
- illustration-story — comics, children's book art, narrative scenes.
- stylized-concept — style-driven concept art, 3D/stylized renders.
- historical-scene — period-accurate/world-knowledge scenes.

Edit:
- text-localization — translate/replace in-image text, preserve layout.
- identity-preserve — try-on, person-in-scene; lock face/body/pose.
- precise-object-edit — remove/replace a specific element (including interior swaps).
- lighting-weather — time-of-day/season/atmosphere changes only.
- background-extraction — transparent background / clean cutout; ask for a real alpha channel.
- style-transfer — apply reference style while changing subject/scene.
- compositing — multi-image insert/merge with matched lighting/perspective.
- sketch-to-render — drawing/line art to photoreal render.

## Prompt schema

```text
Use case: <taxonomy slug>
Asset type: <where the asset will be used>
Primary request: <user's main prompt>
Input images: <Image 1: role; Image 2: role> (optional)
Orientation: <square / landscape 3:2 / portrait 2:3 / 16:9 banner> (optional)
Scene/backdrop: <environment, or "transparent background (real alpha channel)">
Subject: <main subject>
Style/medium: <photo/illustration/3D/etc>
Composition/framing: <wide/close/top-down; placement>
Lighting/mood: <lighting + mood>
Color palette: <palette notes>
Materials/textures: <surface details>
Text (verbatim): "<exact text>"
Constraints: <must keep/must avoid>
Avoid: <negative constraints>
```

- Use only the lines that help; keep it short.
- For edits, list invariants explicitly (`change only X; keep Y unchanged`).
- If a critical detail is missing and blocks success, ask; otherwise proceed.

### Examples

```text
Use case: product-mockup
Asset type: landing page hero
Primary request: a minimal hero image of a ceramic coffee mug
Orientation: landscape 16:9
Style/medium: clean product photography
Composition/framing: wide composition with usable negative space for page copy
Lighting/mood: soft studio lighting
Constraints: no logos, no text, no watermark
```

```text
Use case: background-extraction
Asset type: game sprite
Input images: Image 1: edit target
Primary request: remove the background
Scene/backdrop: transparent background (real alpha channel)
Constraints: change only the background; keep the character, edges, and colors unchanged; no halo
```

## Prompting best practices
- Order: scene/backdrop → subject → details → constraints.
- Include intended use (ad, UI mock, infographic) to set polish level.
- Use camera/composition language for photorealism.
- Quote exact text and specify typography and placement; spell tricky words letter by letter and require verbatim rendering.
- For multi-image inputs, reference images by index and describe how each is used.
- For edits, repeat invariants every iteration to reduce drift.

## Reference map
- `references/prompting.md`: prompting principles and use-case tips.
- `references/sample-prompts.md`: copy/paste specs per use case and asset type.
- `scripts/codex_image.sh`: runs `codex exec` with the built-in `image_gen` tool and copies results.
- `scripts/alpha_report.py`: checks PNG transparency (standard library only).

Adapted from the Codex `imagegen` skill (Apache 2.0, see `LICENSE.txt`).
