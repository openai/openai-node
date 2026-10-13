# Ask a question about local pages

For installed Chrome on Linux, see [Choose a local browser](../../../docs/browser.md#choose-a-local-browser).

This small example reads a three-page visitor guide and answers your question.
Responses chooses which pages to read. The driver exposes only page text, tabs
and navigation to those three pages. It cannot submit a form or change a record.
Playwright serves the pages from memory and blocks every other browser request.

From the `examples` directory of a Node SDK source archive, install the SDK and
browser dependency:

```sh
npm install --no-save openai@latest playwright@1.63.0
npx playwright install chromium
```

Set `OPENAI_API_KEY` and `OPENAI_MODEL` in your shell, then ask a question:

```sh
node responses/browser/read-only.mjs "Can a group of 14 visit on Monday? Which entrance is accessible?"
```

The answer should explain that the museum is closed on Monday, a group of 14
needs a reservation, and the accessible entrance is in the East Courtyard. It
should cite the local guide pages. The example cannot make a reservation.

Try a different question, such as "When is quiet hour?" To change the source
material, edit `reader-site.json`. The next run reads the current file. The model
does not receive a hidden answer table.

## Adapt the driver

Open `read-only.mjs`. `openReader` owns the browser, supplies three local pages
and defines the small driver. `answerQuestion` gives that driver to
`ResponsesToolRunner`. Keep the browser alive until the run finishes, then close
it in `finally`.

For your application, replace the documents and the exact allowed URLs. Keep the
operation list explicit. Add an editing method only when you also have a current
target check, an approval policy and an independent check of the saved result.
See the [interactive dashboard](../../browser-use-demo/README.md) for that path.

## Check it without a key

```sh
node responses/browser/exercise-read-only.mjs
```

The check uses real Chromium and the installed SDK with controlled local API
replies. It asks two different questions, checks changed page content, refuses
outside navigation and rejects a disabled click. It does not measure a model's
answer quality or call an API provider.

The reader scans at most 2,000 DOM nodes and returns at most 16 KiB of UTF-8
text, the same text budget as the generic browser example. Its three methods
and string result stay unchanged. If content exceeds either budget, the result
ends with `[Some document content was omitted.]`. Links that do not fit are
omitted completely so a partial URL cannot be used for navigation. Split large
documents into linked pages to make the rest accessible.

Custom document paths must produce a full `http://reader.invalid/` URL of at
most 16 KiB. The reader refuses longer URLs before opening Chromium; it never
shortens a destination. Tab titles use up to 1 KiB of UTF-8 text. Keep paths
short so the URL and surrounding guide text can fit together in a read.
