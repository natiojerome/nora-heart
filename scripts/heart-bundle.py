#!/usr/bin/env python3
"""Encrypted offline snapshot. Caller must quiesce all writers before create.
No command execution on restore; extraction requires a new empty directory.
The age identity is deliberately never included in a bundle.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tarfile
import tempfile


def digest(file):
    h = hashlib.sha256()
    with open(file, 'rb') as stream:
        for part in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(part)
    return h.hexdigest()


def create(config_file, output, recipient):
    config = json.loads(Path(config_file).read_text())
    target = Path(output)
    if target.exists():
        raise ValueError('Destination déjà présente.')
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.TemporaryDirectory(prefix='.heart-', dir=target.parent) as folder:
        root = Path(folder)
        # No plaintext dump remains outside this private, automatically removed folder.
        with (root / 'database.dump').open('wb') as stream:
            subprocess.run(config['dumpCommand'], stdout=stream, stderr=subprocess.DEVNULL, check=True)
        with tarfile.open(root / 'files.tar', 'w') as archive:
            for name, source in config['paths'].items():
                if not name or '/' in name or name in ('.', '..'):
                    raise ValueError('Nom de périmètre invalide.')
                path = Path(source)
                if not path.exists() or path.is_symlink():
                    raise ValueError('Source manquante ou lien racine refusé.')
                archive.add(path, arcname='files/' + name, recursive=True, filter=lambda entry: None if entry.name=='files/state/maintenance' else entry)
        # Record every regular file, directory and symlink, including link targets.
        # Links are retained as data in the archive; extraction below rejects escaping links.
        manifest = {'format': 1, **({'database': config['database']} if 'database' in config else {}), 'revision': config.get('revision'), 'scopes': list(config['paths']),
                    'payloads': {name: digest(root / name) for name in ('database.dump', 'files.tar')}}
        (root / 'manifest.json').write_text(json.dumps(manifest))
        encrypted = root / 'bundle.age'
        encrypt = subprocess.Popen(['age', '-r', recipient, '-o', str(encrypted)], stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
        try:
            with tarfile.open(fileobj=encrypt.stdin, mode='w|') as archive:
                for name in ('database.dump', 'files.tar', 'manifest.json'):
                    archive.add(root / name, arcname=name)
            encrypt.stdin.close()
            if encrypt.wait() != 0:
                raise RuntimeError('Chiffrement échoué.')
        finally:
            if encrypt.poll() is None:
                encrypt.kill()
                encrypt.wait()
        os.chmod(encrypted, 0o600)
        # Atomic publication, refusing an existing name (also on a race).
        os.link(encrypted, target)
        with target.open('rb') as stream:
            os.fsync(stream.fileno())
        fd = os.open(target.parent, os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    return manifest


def unpack(bundle, identity, directory):
    root = Path(directory)
    if root.exists():
        raise ValueError('La restauration exige un nouveau dossier.')
    root.mkdir(mode=0o700, parents=False)
    try:
        decrypt = subprocess.Popen(['age', '-d', '-i', identity, bundle], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        try:
            with tarfile.open(fileobj=decrypt.stdout, mode='r|') as archive:
                seen = set()
                for entry in archive:
                    if entry.name not in ('database.dump', 'files.tar', 'manifest.json') or not entry.isfile() or entry.name in seen:
                        raise ValueError('Conteneur invalide.')
                    seen.add(entry.name)
                    with (root / entry.name).open('xb') as output:
                        shutil.copyfileobj(archive.extractfile(entry), output)
            if decrypt.wait() != 0 or len(seen) != 3:
                raise ValueError('Archive chiffrée invalide.')
        finally:
            decrypt.stdout.close()
            if decrypt.poll() is None:
                decrypt.kill()
                decrypt.wait()
        manifest = json.loads((root / 'manifest.json').read_text())
        if manifest.get('format') != 1 or set(manifest['payloads']) != {'database.dump', 'files.tar'}:
            raise ValueError('Manifeste invalide.')
        for name, expected in manifest['payloads'].items():
            if digest(root / name) != expected:
                raise ValueError('Intégrité invalide.')
        with tarfile.open(root / 'files.tar') as archive:
            # Treat links conservatively: record them without making them traversable.
            # Restoring links is an explicit operator decision after reviewing links.json.
            links = []
            for entry in archive:
                parts = PurePosixPath(entry.name).parts
                if not parts or parts[0] != 'files' or '..' in parts or PurePosixPath(entry.name).is_absolute():
                    raise ValueError('Chemin refusé.')
                if entry.issym() or entry.islnk():
                    links.append({'path': entry.name, 'target': entry.linkname, 'kind': 'symlink' if entry.issym() else 'hardlink'})
                    continue
                if not entry.isfile() and not entry.isdir():
                    raise ValueError('Type de fichier refusé.')
                # No links were created, no archive entry can redirect a later write.
                archive.extract(entry, root, filter='data')
            (root / 'links.json').write_text(json.dumps(links))
        (root / 'files.tar').unlink()
        return manifest
    except BaseException:
        shutil.rmtree(root)
        raise


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='action', required=True)
    c = commands.add_parser('create')
    c.add_argument('--config', required=True)
    c.add_argument('--output', required=True)
    c.add_argument('--recipient', required=True)
    r = commands.add_parser('extract')
    r.add_argument('--bundle', required=True)
    r.add_argument('--identity', required=True)
    r.add_argument('--directory', required=True)
    args = parser.parse_args()
    if args.action == 'create':
        create(args.config, args.output, args.recipient)
    else:
        unpack(args.bundle, args.identity, args.directory)
    print('Archive Heart vérifiée.' if args.action == 'extract' else 'Archive Heart chiffrée créée.')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Opération de sauvegarde impossible. Aucun secret journalisé.', file=__import__('sys').stderr)
        raise SystemExit(1)
