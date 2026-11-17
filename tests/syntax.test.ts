import { test } from 'node:test';
import assert from 'node:assert/strict';
import { highlightLines, languageForFile } from '../src/ui/syntax';

test('diff syntax highlights common languages while preserving source text and line boundaries', () => {
  const samples = [
    ['App.tsx', 'export const title: string = "hello";'], ['view.jsx', 'const node = <div title="hello"/>;'],
    ['Main.java', 'public class Main { int count = 1; }'], ['main.py', 'def greet():\n    return "hello"'],
    ['main.go', 'package main\nfunc main() { println("hello") }'], ['main.rs', 'fn main() { let count = 1; }'],
    ['style.css', '.item { color: red; }'], ['data.json', '{"enabled": true}'], ['config.yaml', 'enabled: true'],
    ['App.vue', '<template><div class="item">Hello</div></template>'], ['query.sql', 'SELECT id FROM users WHERE id = 1;'],
    ['build.ps1', '$value = "hello"'], ['Dockerfile', 'FROM node:22\nRUN npm ci'], ['Main.kt', 'fun main() { val name = "hello" }'],
  ];
  for (const [file, text] of samples) {
    const lines = text.split('\n'); const highlighted = highlightLines(file, lines);
    assert.ok(languageForFile(file), file);
    assert.deepEqual(highlighted.map(line => line.map(token => token.text).join('')), lines, file);
    assert.ok(highlighted.some(line => line.some(token => token.className)), file);
  }
  const multiline = ['/* comment', 'still a comment */', 'const value = "<script>alert(1)</script>";'];
  const tokens = highlightLines('safe.ts', multiline);
  assert.ok(tokens[1].some(token => token.className.includes('comment')));
  assert.deepEqual(tokens.map(line => line.map(token => token.text).join('')), multiline, 'Markup stays text, never becomes HTML elements');
  assert.deepEqual(highlightLines('unknown.xyz', ['<img onerror=alert(1)>']), [[{ text: '<img onerror=alert(1)>', className: '' }]]);
  const long = 'const item = 1;'.repeat(1000);
  assert.deepEqual(highlightLines('large.js', [long]), [[{ text: long, className: '' }]], 'Long generated lines bypass expensive tokenization');
});
