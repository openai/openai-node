# Pointer tasks in a public fixture

The browser helper accepts an optional `zoom` driver member.
It takes `{ tab_id, region: [x0, y0, x1, y1] }`, with four nonnegative safe
integers and positive width and height. The driver returns an `input_image`
for a function output; the helper adds text and state. Like a screenshot,
a zoom result must contain at least one nonempty `image_url` or `file_id`.
Both sources may be present. The other supported fields are `type`,
`detail`, and `prompt_cache_breakpoint`. Omit `detail`, set it to `null`, or
use `auto`, `low`, `high`, or `original`. A cache breakpoint may be
`{ mode: 'explicit' }` or `null`. See the [image return contract](browser.md#driver-contract).
Zoom appears in the tool list only when the driver implements it and the
member selector enables it. To require confirmation, include `zoom` in
`confirmReads`. URL policy callbacks do not run for zoom.

Your application owns the pixel boundary. Expose `zoom` only when it can safely return that region from an authorized current display. Browser coordinates continue to refer to the full viewport. Do not infer permission for native input from the presence of a screenshot or an element reference.

The included [standalone desktop](../examples/computer-desktop/README.md) demonstrates the separate native computer protocol on a disposable guest. The booking example does not implement zoom or arbitrary pointer operations.
