import { highlight, highlightLine } from './syntax';

const kinds = (line: string, language: Parameters<typeof highlightLine>[1]) =>
  highlightLine(line, language).map((t) => `${t.kind}:${t.text}`);

describe('highlightLine', () => {
  it('colours .properties comments, keys, separators and typed values', () => {
    expect(kinds('#Minecraft server properties', 'properties')).toEqual([
      'comment:#Minecraft server properties',
    ]);
    expect(kinds('max-players=20', 'properties')).toEqual([
      'key:max-players',
      'punct:=',
      'number:20',
    ]);
    expect(kinds('pvp=true', 'properties')).toEqual(['key:pvp', 'punct:=', 'boolean:true']);
    expect(kinds('motd=Olá mundo', 'properties')).toEqual([
      'key:motd',
      'punct:=',
      'string:Olá mundo',
    ]);
  });

  it('colours yaml keys, values, list items and trailing comments', () => {
    expect(kinds('  spawn-limits: 10 # per chunk', 'yaml')).toEqual([
      'punct:  ',
      'key:spawn-limits',
      'punct::',
      'text: ',
      'number:10 ',
      'comment:# per chunk',
    ]);
    expect(kinds('- name: Steve', 'yaml')[1]).toBe('key:name');
    expect(kinds('url: "http://x#y"', 'yaml').some((t) => t.startsWith('comment'))).toBe(false);
  });

  it('colours json keys apart from string values', () => {
    expect(kinds('  "name": "Steve", "op": true', 'json')).toEqual([
      'text:  ',
      'key:"name"',
      'punct::',
      'text: ',
      'string:"Steve"',
      'punct:,',
      'text: ',
      'key:"op"',
      'punct::',
      'text: ',
      'boolean:true',
    ]);
  });

  it('colours toml sections and key/value pairs', () => {
    expect(kinds('[world]', 'toml')).toEqual(['key:[world]']);
    expect(kinds('seed = 42', 'toml')).toEqual(['key:seed', 'punct: = ', 'number:42']);
  });

  it('leaves unknown formats as plain text', () => {
    expect(kinds('hello', 'plain')).toEqual(['text:hello']);
    expect(highlightLine('', 'plain')).toEqual([]);
  });
});

describe('highlight', () => {
  it('returns one token list per line and ignores CR from CRLF files', () => {
    const lines = highlight('a=1\r\n#x\r\n', 'properties');
    expect(lines).toHaveLength(3);
    expect(lines[0].at(-1)).toEqual({ kind: 'number', text: '1' });
    expect(lines[2]).toEqual([]);
  });
});
