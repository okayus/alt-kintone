/**
 * Vite が解決するアセットの型。
 *
 * `import './shell/app.css'` は Vite が処理する副作用 import で、tsc から見ると
 * 型宣言の無いモジュールになる（TS2882）。`vite/client` の型を丸ごと引き込むと
 * `import.meta.env` など使っていないものまで入るので、必要なぶんだけ宣言する。
 */
declare module '*.css' {}
