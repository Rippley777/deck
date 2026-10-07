import { expect, it } from 'vitest';
import { discoverProjectFiles } from '../src/lib/discovery';
it('discovers project roots without reading files and ignores installed dependencies', () => {
  expect(
    discoverProjectFiles([
      'workspace/deck/package.json',
      'workspace/deck/Cargo.toml',
      'workspace/game/pyproject.toml',
      'workspace/deck/node_modules/other/package.json',
      'workspace/deck/.env',
      'workspace/tool/.git/config',
    ]),
  ).toEqual([
    { name: 'deck', path: 'workspace/deck' },
    { name: 'game', path: 'workspace/game' },
    { name: 'tool', path: 'workspace/tool' },
  ]);
});
