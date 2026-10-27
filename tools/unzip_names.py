# Extracts a zip whose file names use the old DOS code page (e.g. "Pokémon"
# folders), which macOS unzip refuses. Usage: python3 -I unzip_names.py in.zip outdir
import os
import sys
import zipfile

src, out = sys.argv[1], os.path.abspath(sys.argv[2])
with zipfile.ZipFile(src) as z:
    for info in z.infolist():
        name = info.filename.replace('Pokémon', 'Pokemon').replace('é', 'e')
        dest = os.path.normpath(os.path.join(out, name))
        if not dest.startswith(out):
            continue  # skip anything trying to escape the output folder
        if name.endswith('/'):
            os.makedirs(dest, exist_ok=True)
            continue
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, 'wb') as f:
            f.write(z.read(info))
