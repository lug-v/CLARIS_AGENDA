# Módulo de gastos da Clari

## Como usar (Telegram)

- **Texto:** "gastei 45,90 no mercado no Pix", "uber 23 reais", "/gasto 32,50 almoço no débito".
- **Áudio:** fale do mesmo jeito; a transcrição segue o mesmo fluxo.
- **Foto:** envie a nota fiscal, cupom ou comprovante de Pix/cartão. A IA identifica se a foto é um comprovante; se não for, ela é tratada como agenda.
- **Resumo:** `/gastos`, `/gastos mês passado`, `/gastos 2026-09` ou "quanto gastei em setembro?".

Todo gasto passa por uma tela de confirmação (✅ Registrar / ❌ Cancelar). Depois de registrado, o botão ↩️ Desfazer remove o lançamento.

## Fluxo

1. `detectExpenseIntent` (regras determinísticas) separa gastos de compromissos.
2. `interpretExpenseText` ou `interpretReceiptImage` (Groq) extraem os dados em JSON.
3. `normalizeExpense` valida valor, data, categoria e forma de pagamento.
4. O rascunho fica em `telegram_pending_expenses` por 30 minutos.
5. Após a confirmação, o gasto vai para `expenses`.

## Tabela `expenses` (pensada para análise em Python)

| Coluna | Tipo | Observação |
| --- | --- | --- |
| `amount` | NUMERIC(12,2) | Valor pago em reais |
| `spent_on` | DATE | Data do gasto |
| `merchant` | texto | Estabelecimento |
| `description` | texto | Resumo do que foi comprado |
| `category` | texto | Alimentação, Mercado, Transporte, Moradia, Saúde, Lazer, Compras, Educação, Assinaturas, Outros |
| `payment_method` | texto | pix, crédito, débito, dinheiro, boleto, não informado |
| `items` | JSONB | Itens lidos da nota (`name`, `quantity`, `total`) |
| `source` | texto | texto, audio ou foto |
| `confidence` | float | Confiança da IA (0 a 1) |

Exemplo de leitura com pandas:

```python
import pandas as pd
from sqlalchemy import create_engine

engine = create_engine(DATABASE_URL.replace("postgresql://", "postgresql+psycopg://"))
df = pd.read_sql("SELECT * FROM expenses ORDER BY spent_on", engine, parse_dates=["spent_on"])
df.groupby("category")["amount"].sum().sort_values(ascending=False)
```

## Próximos passos

- Trocar a categoria por botões antes de confirmar.
- Limite mensal por categoria com alerta no Telegram.
- Tela de gastos na versão web.
- Projeto `clari-analytics` em Python: análise exploratória, detecção de anomalias e previsão do mês.
