# ビルドと検証

[English](development.en.md)

配布EXEを使うだけなら、この作業は不要です。コマンドはリポジトリのルートで実行します。

## 必要な環境

Windows x64、.NET 10 SDK、Node.js 22以降、PowerShell 7を使用します。公開実装を含むdual・upstream版には、Ruby 3.4.11 x64、Bundler 2.6.9、RubyInstaller Devkitなどのネイティブgemのビルド環境、Gitが必要です。依存パッケージと実行資材の初回取得には通信します。

## 配布EXEの作成

```powershell
# 出力先は未作成のフォルダを指定
.\scripts\prepare-original-engines.ps1 -RubyDirectory C:\Ruby34-x64
# リリース用：3版すべてをZstandardの最高レベルで圧縮
.\scripts\build.ps1 -Edition all -OriginalEngineDirectory artifacts/OriginalEngines -CompressionCodec zstd -CompressionQuality 22
```

出力は `artifacts/MDV-<版>-win-x64/MDV-v0.3.2-<版>-win-x64.exe` とSHA-256ファイルです。各出力フォルダは再作成するため、使用中のEXEや個人設定を置かないでください。dual・upstreamを配布し、customは他の2版より厳密に小さい場合に配布します。サイズと判定は `artifacts/edition-sizes-win-x64.json` に記録されます。スクリプトはアップロードを行いません。

開発時の既定値はZstandardレベル3です。リリース時は必ず `-CompressionQuality 22` を指定します。圧縮後に全資材のSHA-256を元ファイルと照合します。.NETの単一EXE化も使用します。

| オプション | 用途 |
| --- | --- |
| `-Edition dual` / `upstream` / `custom` | 個別の版を作成。省略時はdual。customではRuby資材の指定不要 |
| `-FixedRuntimeDirectory C:\SDK\WebView2Fixed-x64` | 取得済みのWebView2を使う |
| `-CompressionQuality 3` | 開発用の高速な圧縮 |
| `-SkipTests` | 開発時のみ、ビルド前テストを省略 |

customでは `-Runtime win-arm64` と対応するFixed Runtimeを指定できますが、ARM64は配布・実機検証の対象外です。

## 構成

| フォルダ | 内容 |
| --- | --- |
| `src` | Windowsアプリと共通処理 |
| `renderer` | Markdown変換・表示・ブラウザーテスト |
| `engines/original` | 公開実装のRubyワーカーと固定依存定義 |
| `scripts`、`tools` | ビルド・資材の準備・検証 |
| `tests` | 共通処理、公開実装、互換性の回帰試験と期待値 |
| `samples` | アプリから開く表示サンプル |
| `third_party` | 外部資材とライセンス |
| `docs` | 現在の使い方・制限・ビルド手順 |

JavaScript依存は `package-lock.json`、Ruby依存は `engines/original/Gemfile.lock`、WebView2は `scripts/webview2-runtime.json` で固定しています。試験データの出典・ライセンスは `tests/compatibility/sources.lock.json` と同梱ライセンスを参照してください。生成物・取得した記事・検証レポートは `artifacts/` に置き、Gitへ追加しません。

## 開発用の起動

WebView2 Evergreen Runtimeが必要です。

```powershell
npm ci
npm run build -- custom
dotnet run --project src/Mdv.App -p:MdvEdition=custom
```

dual・upstreamの場合は準備した `OriginalEngines` を `src/Mdv.App/OriginalEngines` にコピーし、レンダラーとアプリの両方で同じ版を指定します。

## リリース前の検証

```powershell
npm test
npm run compat:check
'dual', 'custom', 'upstream' | ForEach-Object {
    dotnet run --project tests/Mdv.Core.Tests -c Release "-p:MdvEdition=$_"
}
npm run upstream:setup
$env:MDV_RUBY = (Get-Command ruby).Source
npm run upstream:test
npm run build
npx playwright install chromium
npm run test:browser
# build.ps1 -Edition all の生成後
npm run test:editions
'dual', 'custom', 'upstream' | ForEach-Object {
    .\scripts\smoke-windows.ps1 -BuildDirectory "artifacts/MDV-$_-win-x64" -Report "artifacts/verification/$_/native-smoke.json"
}
```

`MDV_RUBY` を省略すると公開実装を使うブラウザーテストがスキップされます。配布検証では必ず指定してください。Windowsの検証は配布EXEを別フォルダにコピーして起動し、画面操作、PDF、オフライン保存画像・カード、設定、移動・改名後の再起動を確認します。

WSL上の文書の変更検知は、Windowsから `scripts/smoke-wsl.ps1 -WslDirectory '\\wsl.localhost\Ubuntu\home\yourname\tmp' -BuildDirectory artifacts/MDV-dual-win-x64` で確認できます。指定フォルダは既存・書込可能で、WSL側にPython 3が必要です。

## 実サイトとの比較

先に `npm run build` を実行します。`node scripts/upstream/sample-sources.mjs --mode github --out artifacts/comparison/github-sources.json` で候補とシードを保存します。Qiitaは `--mode qiita` を指定します。候補からの抽出であり、サイト全体からの一様な無作為抽出ではありません。

```powershell
npm run upstream:service -- --refresh --visual --mode github --sources artifacts/comparison/github-sources.json --seed SEED --consecutive 5 --offset 0 --out artifacts/comparison/github
```

最初の差異、取得・実行エラー、または5文書連続一致で停止します。修正後は問題の文書を再検証し、未検証の文書から連続数を0に戻して再開します。取得失敗や差異を飛ばして成功件数に含めないでください。

`--visual` は本文幅800px・ライトテーマで、両エンジンそれぞれと本家の本文・ブロック画像、描画に関わるCSS、DOMと操作領域を比較します。見出し本文・アンカー、本文リンク、画像、summaryに実際にマウスを移動してホバーも比較します。RGBA各成分の差16を超える画素が1個でもあれば差異です。

両側に同じグレースケール文字描画を適用します。単純な見出しSVGは元のパス・色を独立SVG画像として描画し、文書の描画状況による輪郭差を抑えます。元DOMの位置・寸法と正規化前の画像・差分も保存します。外側のサイトUI、コピー操作、カード・数式・図の内部ホバー、閉じたdetails、キーボードフォーカス、ダーク・レスポンシブ条件は、この実サイト比較の対象外です。アプリの別の回帰試験と区別してください。

Qiitaの保存機能は `--qiita-image-snapshots --qiita-card-snapshots` で比較します。.NETの製品コードで取得・保存・ハッシュ検証した資材を使い、カードのタイトル・サムネイルも画像比較に含めます。通常は保存済みデータを再利用し、本家を取得し直す場合は `--refresh` を指定します。

GitHubのissue/PR自動参照はオンラインのサービス機能に依存します。`--exclude-service-issue-links` を指定すると本家が生成した参照だけを原文に戻して比較し、除外内容を記録します。著者が明示したリンクは対象外です。

この比較は全記事・全テーマ・全画面幅での同一性を保証しません。`compat:check` も保存済みの結果からの変化を検出するものであり、本家との完全互換の証明ではありません。

### 数式の比較テスト

`npm run compat:math` は、数式5種類×GitHub／Qiita×ライト・ダーク・印刷の30ケースを、本文の表示条件を揃えた独立のMathJax描画と比較します。DOMと画像寸法の一致、RGBA各成分の差16・差分画素率1%以内を要求し、不一致は失敗終了します。結果は `artifacts/compatibility/browser-math/index.html` に保存します。実サイトとの一致を検証するものではありません。

GitHubの両エンジンを直接比較するには、`MDV_RUBY` を設定して `npm run test:browser -- renderer/test/browser/github-math-engines.spec.mjs` を実行します。15ケースで数式DOM（実行時のメニュー識別番号を除く）と画像を比較し、画像は補正・許容差なしで寸法一致と差分0画素を要求します。結果は `artifacts/github-math-engines/` に保存します。`MDV_RUBY` 未指定時はスキップされます。
