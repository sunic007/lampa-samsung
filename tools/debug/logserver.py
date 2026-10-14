# Принимает журнал отладочной сборки с телевизора: python tools/debug/logserver.py
import http.server, datetime, os

LOG = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tv.log')


class Handler(http.server.BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', 0))).decode('utf-8', 'replace')
        with open(LOG, 'a', encoding='utf-8') as f:
            f.write('--- %s from %s\n%s\n' % (datetime.datetime.now().strftime('%H:%M:%S'), self.client_address[0], body))
        self.send_response(204)
        self._cors()
        self.end_headers()

    def log_message(self, *args):
        pass


print('log ->', LOG)
http.server.ThreadingHTTPServer(('0.0.0.0', 8799), Handler).serve_forever()
