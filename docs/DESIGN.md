# Design notes: Level 1 (Parking Garage)

## Asset pipeline

Source of truth for art is the Blockbench `.bbmodel` files in `assets/source/`.
`npm run assets` (`tools/build-assets.mjs`) converts them to `.glb` and writes
`public/assets/asset_manifest.json`. Nothing in `public/assets/` is hand edited.

Facts about the source files that the pipeline relies on:

- All elements are cubes with per-face UVs, no face rotation. Keyframes are `catmullrom` or `linear`, with no Molang. Textures are embedded PNG palettes.
- Blockbench units are pixels; the converter scales by 1/16 so 1 unit = 1 m (a character is about 2.1 m tall).
- Models face **-Z** in Blockbench (Shiva's third eye is at z = -3.6). The runtime rotates each model by PI inside its entity so entity forward is +Z.
- Hand sockets are **locators**: `socket_hand_l` / `socket_hand_r` under each forearm on every humanoid. Shiva adds `socket_third_eye_point`, `socket_trishul_hand_point` and `socket_trishul_back_point`.
- Root motion lives in the top group's position channel. Notable offsets (px): `get_up` z +7.4, `knockdown` z +3.2, `guard_break` z +2.6. +Z is backwards for the model.
- The ult chain is authored to connect: `ult_ascend` ends with the root at y = 10 px, where `shiva_manifest` begins, and `shiva_release` ends at y = 10, where `ult_descent` begins. The model swap happens mid-air with no pop.
- `shiva_ambient` animates only `cobra_head` / `cobra_tongue`, which no other clip touches, so it plays as a full-weight second layer.
- Crates and broken bottles are **inside `parking-garage`** under the `pickups` group (`crate_1..7`, `broken_bottle_1..4`). The runtime detaches them into pickup entities. Bottles are also the template for thrown bottles.
- Props (`props.bbmodel`) are laid out side by side; each prop's group origin is its attach pivot. Prop clips target sub-nodes (e.g. `molotov_impact` targets `flame_N`, `fireball`, ...), so a cloned prop subtree gets its own mixer.
- `trinetra_beam` extends from its pivot toward -Z (about 3.8 m), so it fires forward from the third-eye socket.
- `molotov_fire` is about 0.9 m across at authored scale, too small to read as a hazard, so gameplay scales it.

### Root motion
The manifest records each clip's end offset (`rootMotion`). At runtime the root's horizontal track is
removed from the clip and replayed as per-frame deltas on the entity (`AnimationController`). The
total equals applying the offset when the clip ends, but this version is also correct when a clip is
interrupted, and it lets collision act every frame instead of letting the model snap through a pillar.

## Garage layout (meters, after /16)

- Floor at y = 0, x in [-15, 15], z in [-11.1, 11.1]. The north side (z < -10.6) is a 1.3 m parapet open to the outside.
- Pillars at x approx -11.1, -4.6, 1.9, 8.4 and z approx +/-4.5.
- Stairs on the east side: x 9.4 to 15, z -2.75 to 0.25, rising 0.19 m per 0.375 m step to a landing at 2.25 m (x >= 13.9).
- Exit door in the east wall at the landing: x = 15, z -2 to -0.4.
- Flow is west to east: spawn near the west wall, waves in the middle bays, boss at the foot of the stairs.

## Animation convention (fixed 2026-10-01)
These are Blockbench *free-format* models: keyframe rotations and positions add straight onto
the rest pose. The first converter negated X/Y like the Bedrock format, which mirrored every pose
front-to-back (punches went behind the character). `fight_stance` keys `arm_left` x = +62 and must
raise the arm toward -Z, the side the face is on. That is the regression check.

## Camera
True isometric: an orthographic camera turned 45 degrees to the room, from the south-east corner looking
north-west, at the isometric elevation atan(1/sqrt 2), about 35.26 degrees, showing 13 m of height. The run
toward the stairs goes down-right on screen, toward the camera, so the player is seen from the front.
Orthographic means fighters never change size with depth, so spacing is easy to judge. The camera
never orbits, and stick directions map straight to the screen. The near walls (south and east) and
everything overhead are hidden (`cutaway`); the exit door, its frame and the sign remain. Every pillar is
clipped at 2.6 m (`cutlow`); collision is unchanged.

## Feedback philosophy (minimal)
Hits are read from the body reaction animation plus a few frames of hitstop. There are no impact
particles, no white hit flash and no damage vignette; screen shake is reserved for heavy blows. The
only effects are gameplay tells (attack glow, "!" on heavy wind-ups, landing rings for thrown
objects), the Molotov fire itself, and the Shiva ult / boss phase-change shockwaves. Bottles cause
a normal body hit; a crate flattens the target with the `dead` clip, it stays down, then gets up
(`get_up`, or the fall reversed) with a big chunk of health gone.

## Combo
Jab, jab, hook, uppercut. Each click must land in the previous punch's window: from its hit frame
until 0.3 s after it recovers. Earlier clicks are discarded (mashing does not chain), later ones
restart at the first jab.

## Status
Level 1 plays end to end: waves 1 and 2, the boss intro, both phases (Molotov Rain, crate toss,
blocking with guard break), the Shiva ult, death and checkpoint retry, the door, the exit and the
Level 2 placeholder. Dev shortcuts: `?skip=wave2` and `?skip=boss`; `window.__game` in the console;
`/viewer.html` for clips and hit windows. Unit tests: `npm test`.

## Combat timing (authored in `assets/manifest.authored.json`)
Hit windows come from the frame where the striking forearm is most extended:
jab 0.14 s, hook 0.24 to 0.30 s, uppercut 0.30 s, boss cross 0.18 s, haymaker 0.56 s (wind-up 0 to 0.42 s),
combo_3hit 0.16 / 0.55 / 1.26 s, henchman combo 0.13 / 0.48 / 0.72 s, palm_strike 0.22 s,
tandava_stomp 0.62 s, trishul_prahar 1.35 s, trinetra beam while the eye lid is open (1.0 to 2.45 s).
