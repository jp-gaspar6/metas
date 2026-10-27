# Metas do Gaspar

Rastreador de hábitos pessoais: HTML/CSS/JS puro + Supabase (banco e login) + Cloudflare Pages.

**App publicado:** https://metas-gaspar.pages.dev

## Arquivos
| arquivo | o que faz |
|---|---|
| `index.html` | estrutura das telas |
| `styles.css` | visual (celular primeiro, tema claro/escuro) |
| `app.js` | login, leitura/gravação, fila offline, telas Hoje/Semana/Mês |
| `graficos.js` | tela Gráficos, com os extras da meta de unhas (Chart.js) |
| `ajustes.js` | tela Ajustes: metas, sentimentos, Excel, CSV, senha |
| `ideias.js` | tela Ideias: anotar o que fazer um dia e de onde veio |
| `notas.js` | tela Notas, no estilo do Google Keep (texto ou caixinhas, cores, fixar, arquivar, busca) |
| `sw.js` / `manifest.webmanifest` / `icones/` | PWA (instalar no celular, abrir offline) |
| `.github/workflows/keepalive.yml` | consulta a cada 3 dias para o Supabase não pausar |
| `calc.js` | datas no fuso de São Paulo e regras de % |
| `seed.js` | metas padrão + dados iniciais (importados no 1º login) |
| `config.js` | URL e anon key do seu projeto Supabase |
| `schema.sql` | tabelas e RLS — colar no SQL Editor do Supabase |
| `teste.html` / `teste-calc.js` | confere os % com os dados iniciais |

## Etapa (a): primeira configuração

### 1. Criar o projeto no Supabase (grátis)
1. Acesse https://supabase.com → **Start your project** → entre com o GitHub ou com e-mail.
2. **New project**: nome `metas`, crie uma senha do banco (guarde no seu gerenciador de senhas;
   o app não usa essa senha), região **South America (São Paulo)**, plano **Free**.
3. Espere uns 2 minutos até o projeto ficar pronto.
4. Menu lateral → **SQL Editor** → **New query** → cole todo o conteúdo de `schema.sql` → **Run**.
   Deve aparecer "Success. No rows returned".
5. Menu **Authentication → URL Configuration**:
   - *Site URL*: `http://localhost:8000`
   - *Redirect URLs*: adicione `http://localhost:8000/**`
     (na etapa de publicação vamos adicionar o endereço do Cloudflare aqui).
6. Menu **Project Settings → API** (ou **Data API / API Keys**): copie a **Project URL** e a
   chave **anon public** e cole em `config.js`. A chave `service_role` **nunca** entra no código.

### 2. Rodar no seu PC
No terminal, dentro da pasta `C:\dev\metas`:
```
py -m http.server 8000
```
Abra http://localhost:8000 e entre com e-mail e senha.
(Senha esquecida: botão "Definir ou recuperar a senha" na tela de login.)
Novos cadastros estão desligados no Supabase (Authentication → Sign In / Providers),
então só a conta do dono entra.

### 3. Conferir os cálculos
Abra http://localhost:8000/teste.html. A semana 18/10–24/10 deve dar média de 83,3%.

## Regras de cálculo (resumo)
- Semana = domingo a sábado. Só contam os dias até hoje e a partir do início da meta.
- Meta numérica em branco = 0 (não cumprida).
- **Leitura** (`pct_mode = sum`): soma das páginas da semana (fim de semana incluso) ÷
  (10 × dias seg–sex decorridos), limitado a 100%. Meta semanal cheia = 50 páginas.
- **Demais** (`days`): dias cumpridos ÷ dias em que a meta conta.
- **Unhas** (`answered`): dias "Não" ÷ dias com resposta. Dia em branco = "Não" (padrão).
- Média geral = média simples dos % que têm valor. Verde 100%, amarelo 60–99%, vermelho < 60%.

## Publicação (Cloudflare Pages)
O site é publicado automaticamente a cada `git push` na branch `main`.
- Projeto no Cloudflare: Workers & Pages → `metas-gaspar` → conectado a `jp-gaspar6/metas`.
- Configuração de build: *Framework preset* **None**, *Build command* vazio, *Output directory* `/`.
- No Supabase (Authentication → URL Configuration) o endereço publicado precisa estar em
  *Site URL* e em *Redirect URLs* (`https://<endereço>/**`), senão o e-mail de senha não volta ao app.

Ao mudar arquivos do app, aumente `VERSAO` em `sw.js` (ex.: `metas-v2`) para os aparelhos
pegarem a versão nova. O app busca a versão nova sempre que há internet; a VERSAO limpa o cache antigo.

## Instalar no celular
- **Android (Chrome):** abra o link → menu ⋮ → **Instalar app** (ou "Adicionar à tela inicial").
- **iPhone (Safari):** abra o link → botão Compartilhar → **Adicionar à Tela de Início**.
  (Precisa ser pelo Safari; no iPhone outros navegadores não instalam.)

## Anti-pausa do Supabase
O plano Free pausa projetos sem uso por 7 dias. A Action `Manter Supabase ativo` consulta o banco
a cada 3 dias (aba **Actions** do GitHub; dá para rodar na mão com "Run workflow").
O GitHub desliga Actions agendadas depois de 60 dias sem commits no repositório e avisa por
e-mail — se isso acontecer, entre na aba Actions e clique em **Enable workflow**.
Se mesmo assim o projeto pausar, é só entrar no painel do Supabase e clicar em **Restore** (nada se perde).

## Backup
1. **Excel (recomendado, mensal):** Ajustes → *Exportar para Excel*. Guarde o arquivo no seu Drive/OneDrive.
   O arquivo tem os registros diários (mesmo formato aceito pela importação) e os resumos.
2. **Restaurar:** salve a aba *Registros* como CSV separado por `;` e use Ajustes → *Importar CSV*.
3. O plano Free do Supabase **não** faz backup automático acessível — por isso o passo 1.

## Custo
Supabase Free + Cloudflare Pages Free + GitHub (repositório público, Actions grátis) = **R$ 0/mês**.
