import { createServer } from 'http';
import { connect } from 'net';

async function startProxy() {
  const proxy = createServer((_req, res) => {
    res.end();
  });

  proxy.on('connect', (req, clientSocket, head) => {
    const serverSocket = connect(443, 'api.openai.com', () => {
      clientSocket.write(
        'HTTP/1.1 200 Connection Established\r\n' + 'Proxy-agent: Node.js-Proxy\r\n' + '\r\n',
      );
      serverSocket.write(head);
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);
    });
  });

  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));

  console.log(proxy.address()!.toString());

  return () => {
    proxy.close();
  };
}
