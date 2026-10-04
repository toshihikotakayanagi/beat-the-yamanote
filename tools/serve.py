# 開発用のサーバー。python -m http.server と同じだが、ブラウザに毎回ファイルの更新を確認させる
# （Cache-Control: no-cache）。これがないと、プログラムを直しても古いものが使われることがある。
#
# 使い方: python tools/serve.py [ポート番号]   （既定は 8173。ゲームのフォルダで実行する）
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8173
root = Path(__file__).resolve().parent.parent
handler = partial(NoCacheHandler, directory=str(root))
NoCacheHandler.extensions_map.update({'.js': 'text/javascript', '.mjs': 'text/javascript'})
print(f'http://localhost:{port} で公開中（{root}）')
ThreadingHTTPServer(('', port), handler).serve_forever()
