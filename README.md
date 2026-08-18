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

## Aviso

Es una herramienta educativa. Las primas por defecto son estimaciones aproximadas, no
cotizaciones reales de mercado, y el contenido no constituye asesoría de inversión. La
integración con TradeStation es de solo lectura (cotizaciones) — no coloca órdenes.
