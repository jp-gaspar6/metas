# Metas do Gaspar

Rastreador de hábitos pessoais: HTML/CSS/JS puro + Supabase (banco e login) + Cloudflare Pages.

## Arquivos
| arquivo | o que faz |
|---|---|
| `index.html` | estrutura das telas |
| `styles.css` | visual (celular primeiro, tema claro/escuro) |
| `app.js` | login, leitura/gravação, fila offline, tela Hoje |
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
Abra http://localhost:8000, digite seu e-mail e clique no link que chegar.
No primeiro login o app cria as 6 metas e importa os dados de 18/10 a 26/10.

> O plano Free do Supabase envia poucos e-mails de login por hora. Se o link não chegar,
> espere alguns minutos e tente de novo.

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

## Publicação e backup
Os passos de publicação e backup entram aqui na etapa (e).
