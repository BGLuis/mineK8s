# Instruções para agentes

## Lint e formatação

- Nunca escreva comentários ou atributos que silenciam o linter, o formatador ou o type checker: `biome-ignore`, `eslint-disable`, `prettier-ignore`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `#[allow(...)]`, `#[rustfmt::skip]` e equivalentes.
- Quando uma regra apontar um problema, corrija o código. Se a regra não serve para o projeto inteiro, desligue-a na configuração da ferramenta (`biome.json`, por exemplo) e explique o motivo na mensagem do commit.
