# sleep sounds · sourcing manifest

All six loops below ship in `apps/web/public/audio/`. The
`SleepSoundPlayer` component references them as `/audio/<name>.mp3`.

| file              | license | replace with commercial when |
|-------------------|---------|------------------------------|
| brown-noise.mp3   | CC0     | never — synthetic noise, no need |
| white-noise.mp3   | CC0     | never |
| pink-noise.mp3    | CC0     | never |
| rain.mp3          | CC0 (freesound) | upgrade to seamless studio loop pre-launch |
| ocean.mp3         | CC0 (freesound) | upgrade pre-launch |
| fire.mp3          | CC0 (freesound) | upgrade pre-launch |

Conventions:
- 30-second seamless loops, no clicks at boundary
- 16-bit, 44.1 kHz, mono → MP3 192 kbps
- Pre-amplitude normalized to −16 LUFS

Replacement steps:
1. Drop new file at same path / same name. Howler picks it up.
2. Run a manual play-through in dev — verify loop boundary is silent.
3. Update this manifest with the new license source.
