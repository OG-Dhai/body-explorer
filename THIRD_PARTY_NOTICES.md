# Third-party notices

This repository includes the following third-party material. Each licence applies only to the files listed for it.

## Music

| File | Work | Licence |
|---|---|---|
| `public/audio/music/background.mp3` | "Bassa Island Game Loop" by Kevin MacLeod ([incompetech.com](https://incompetech.com/music/royalty-free/music.html)), ISRC USUAN1100840 | [Creative Commons Attribution 4.0](http://creativecommons.org/licenses/by/4.0/) |

Credit, as specified by the licensor:

> "Bassa Island Game Loop" Kevin MacLeod (incompetech.com)
> Licensed under Creative Commons: By Attribution 4.0 License
> http://creativecommons.org/licenses/by/4.0/

The file is included unmodified.

## Sound effects

| File | Source | Licence |
|---|---|---|
| `public/audio/sfx/error.mp3` | `negative.wav` from "GUI Sound Effects" by Lokif ([OpenGameArt](https://opengameart.org/content/gui-sound-effects)) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/audio/sfx/success.mp3` | `positive.wav` from the same pack | CC0 1.0 |
| `public/audio/sfx/fireworks.mp3` | `save.wav` from the same pack | CC0 1.0 |
| `public/audio/sfx/wellDone.mp3` | `misc_sound.wav` from the same pack | CC0 1.0 |
| `public/audio/sfx/click.mp3` | An open-source sound library, according to the author. Exact source pending recovery | Pending recovery |

The four files from the Lokif pack were converted from WAV to MP3. `click.mp3` is included unchanged. According to the author it comes from an open-source sound library; its exact source, author and licence have not yet been recovered, and this notice will be updated when they are.

## MediaPipe models

| Files | Source | Licence |
|---|---|---|
| `src/wasm/mediapipe/hand_landmarker.task`, `pose_landmarker_full.task`, `face_landmarker.task` | Google MediaPipe | Apache License 2.0, see [`LICENSE-APACHE-2.0.txt`](LICENSE-APACHE-2.0.txt) |

## npm dependencies

npm packages such as `@mediapipe/tasks-vision` and Three.js are not committed to this repository. They are installed by `npm install` and keep their own licences.
