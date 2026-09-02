# Third-party notice

`vector.py` and `visibility.py` in this directory are adapted from
[**awpy**](https://github.com/pnxenopoulos/awpy) (`awpy/vector.py` and
`awpy/visibility.py`), Copyright (c) 2020-2025 Peter Xenopoulos, MIT
licensed. Changes from upstream: use this package's own `Vector3` instead of
`awpy.vector` (same class, just not importing the rest of the `awpy`
package), stdlib `logging` instead of `loguru`, and dropping the
`numpy.typing` import in `Vector3.from_input` (duck-typed instead) so this
app doesn't need numpy as a dependency for this feature, and a fix in
`KV3Parser._skip_until_first_bracket` for an infinite loop upstream hits on
malformed/truncated input with no `{` and no further newlines (see comment
at that method) — a demo-analysis tool must never hang on a corrupted
extraction. The collision parsing (`KV3Parser`, `VphysParser`) and
raycasting (`AABB`, `BVHNode`, `VisibilityChecker`) logic is otherwise
unchanged.

awpy's own `visibility.py` in turn credits
[AtomicBool/cs2-map-parser](https://github.com/AtomicBool/cs2-map-parser) as
the reference for the `.vphys` parsing approach.

## MIT License (awpy)

```
MIT License

Copyright (c) 2020-2025 Peter Xenopoulos

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Extraction pipeline

The `.vphys` collision data this module consumes is extracted at runtime
from the user's own local CS2 install using
[Source2Viewer-CLI](https://github.com/ValveResourceFormat/ValveResourceFormat)
(`ValveResourceFormat`, MIT licensed) — the same tool
`electron/ai/radarExtractor.ts` already downloads and drives to extract
radar overview images. See `electron/ai/mapGeometryExtractor.ts`.

## Manual verification

Cannot be end-to-end tested without a real CS2 install and a real demo, so
verify manually after building:

1. In the app, open the 2D replay view and click "usar radar real do CS2" —
   this now also extracts map geometry.
2. Confirm `.vphys` files appear under
   `<userData>/cs-demo-analyst/mapgeo/<map>.vphys` (on Windows, `userData`
   is typically `%APPDATA%\cs-demo-analyst`).
3. Re-parse (or import) a demo on one of the extracted maps and check its
   `summary.json` — `calibration.losSource` should read `"geometry"`
   instead of `"heuristic"`.
4. Sanity-check one sightline you know well in that map (e.g. a spot you
   know is *not* visible from a specific angle) against the app's
   Overexposure output, to confirm the geometry is oriented/scaled
   correctly before trusting it broadly.
