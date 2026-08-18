# Simulador de Estrategias de Opciones

![Tests](https://github.com/cherna85-bot/simulador-opciones/actions/workflows/test.yml/badge.svg)

Herramienta educativa de una sola página (HTML/CSS/JS, sin dependencias) para visualizar
la ganancia/pérdida al vencimiento de estrategias comunes con opciones financieras.

## Uso

Abre `index.html` directamente en tu navegador. No requiere instalación ni build.

## Qué incluye

- Estrategias predefinidas: Long Call, Long Put, Covered Call, Protective Put,
  Bull Call Spread, Bear Put Spread, Long Straddle, Long Strangle e Iron Condor.
- Edición de precio de la acción, strikes, primas y cantidad de contratos por posición (leg).
- Gráfico de payoff al vencimiento, con ganancia máxima, pérdida máxima y punto(s) de equilibrio.
- Control de riesgo: ratio riesgo/beneficio, alerta de riesgo de pérdida ilimitada, y una
  calculadora de tamaño de posición (según tu capital y % que estés dispuesto a arriesgar).
- Toma de ganancias: un objetivo de ganancia editable (% de la ganancia máxima, o % de
  retorno sobre la prima si la ganancia es ilimitada) que muestra a qué precio del
  subyacente se alcanzaría. Son reglas generales de referencia, no recomendaciones
  personalizadas.
- Precio teórico con Black-Scholes: además de la curva de ganancia/pérdida *al
  vencimiento*, una segunda curva punteada muestra cuánto valdría la posición
  *hoy* (según la volatilidad implícita y los días a vencimiento que ingreses),
  junto con Delta, Theta (por día) y Vega de la posición completa. Es una
  aproximación educativa de estilo europeo.

## Pruebas

La lógica de cálculo (payoff por leg, ganancia/pérdida máxima, breakeven) vive en
`logic.js`, compartida entre `index.html` y las pruebas. Se corre con el test runner
nativo de Node (sin dependencias que instalar):

```bash
node --test
# o, equivalente:
npm test
```

Un workflow de GitHub Actions (`.github/workflows/test.yml`) corre estas mismas
pruebas automáticamente en cada push y cada pull request a `main`.

## Integración opcional con TradeStation (datos de mercado en vivo)

Si quieres traer la cotización real del subyacente desde tu cuenta de TradeStation
(solo lectura, no ejecuta órdenes), puedes correr el backend local incluido:

```bash
cd server
npm install
cp .env.example .env   # y completa TS_CLIENT_ID / TS_CLIENT_SECRET ahí (nunca en git)
npm start
```

Luego abre `http://localhost:3000` (en vez de abrir `index.html` directo) y usa el botón
"Conectar cuenta" que aparece arriba del formulario. Por defecto usa el entorno **SIM**
(simulado) de TradeStation, no tu cuenta real.

Sin el backend corriendo, `index.html` sigue funcionando exactamente igual que siempre,
de forma 100% manual.

Con la cuenta conectada, también podés cargar velas japonesas en 3 temporalidades
a la vez (4h, 1h y 5min apiladas) para un símbolo — pensado para análisis
multi-temporalidad de day trading/scalping (contexto en 4h/1h, timing de entrada
en 5min). Es una herramienta de análisis: no genera señales ni ejecuta nada, la
lectura y la decisión de entrada siguen siendo 100% tuyas.

## Integración opcional con Alpha Vantage (fundamentales, earnings y noticias)

Con el mismo backend local (`server/`) puedes traer, para cualquier símbolo:
nombre/sector/market cap/P-E de la empresa, la fecha del próximo reporte de
earnings, y hasta 5 noticias recientes con su sentimiento (positivo/neutral/negativo).

1. Consigue una API key gratuita (instantánea, sin tarjeta) en
   https://www.alphavantage.co/support/#api-key
2. Agrégala a `server/.env`: `ALPHAVANTAGE_API_KEY=tu_key`
3. Reinicia el servidor (`npm start` dentro de `server/`) y abre `http://localhost:3000`.

El tier gratuito de Alpha Vantage permite ~25 requests/día — el backend cachea
las respuestas (1h fundamentales/earnings, 15min noticias) para no agotarlo.

Si buscás un símbolo y su próximo earnings cae dentro de los "días a vencimiento"
que configuraste en la sección de Black-Scholes, aparece una advertencia — la
volatilidad implícita suele moverse fuerte alrededor de un reporte de resultados.

## Aviso

Es una herramienta educativa. Las primas por defecto son estimaciones aproximadas, no
cotizaciones reales de mercado, y el contenido no constituye asesoría de inversión. Las
integraciones con TradeStation y Alpha Vantage son de solo lectura — no colocan órdenes
ni dan recomendaciones personalizadas.
