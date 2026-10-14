import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import cson from 'cson-parser';
test('bundled shell grammar preserves all rules from the pinned upstream CSON',async()=>{
  const source=cson.parse(await readFile('third_party/atom-shellscript/shell-unix-bash.cson','utf8'));
  source.name='mdv-shell';source.aliases=[];
  assert.deepEqual(JSON.parse(await readFile('third_party/atom-shellscript/grammar.json','utf8')),source);
});
