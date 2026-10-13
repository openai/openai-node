import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

// Only for the explicitly authored child programs in the lifecycle and view exercises.
export async function writeTestReceipt(root) {
  await promisify(execFile)(
    'python3',
    [
      '-E',
      '-S',
      '-B',
      '-c',
      `import json, os, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import setup
root = Path(sys.argv[2])
receipt = {"recipe": setup.recipe(), "disk": setup.disk_identity(root), "vfkit": setup.digest(root / "bin/vfkit")}
with os.fdopen(os.open(root / "setup.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as output:
    json.dump(receipt, output)
`,
      fileURLToPath(new URL('guest/', import.meta.url)),
      root,
    ],
    { timeout: 30_000, maxBuffer: 65_536 },
  );
}
