'use strict'

/**
 * Minimal RFC 6455 frame codec: text frames, ping/pong, close.
 * No compression, no fragmentation beyond continuation joining, which is all
 * the community node needs.
 */

const OPCODE = { CONT: 0x0, TEXT: 0x1, BINARY: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa }

function encodeFrame(opcode, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8')
  const length = data.length

  let header
  if (length < 126) {
    header = Buffer.alloc(2)
    header[1] = length
  } else if (length < 65536) {
    header = Buffer.alloc(4)
    header[1] = 126
    header.writeUInt16BE(length, 2)
  } else {
    header = Buffer.alloc(10)
    header[1] = 127
    header.writeBigUInt64BE(BigInt(length), 2)
  }

  header[0] = 0x80 | opcode
  return Buffer.concat([header, data])
}

function wrap(socket) {
  let buffer = Buffer.alloc(0)
  let fragments = []
  let fragmentOpcode = null

  const api = {
    OPEN: 1,
    readyState: 1,

    send(text) {
      try {
        socket.write(encodeFrame(OPCODE.TEXT, text))
      } catch {
        /* the peer vanished */
      }
    },

    onMessage(handler) {
      api._messageHandler = handler
    },

    onClose(handler) {
      api._closeHandler = handler
    },

    destroy() {
      try {
        socket.destroy()
      } catch {
        /* already gone */
      }
    },
  }

  const emitClose = () => {
    if (api._closed) return
    api._closed = true
    if (api._closeHandler) api._closeHandler()
  }

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])

    for (;;) {
      if (buffer.length < 2) return

      const fin = (buffer[0] & 0x80) !== 0
      const opcode = buffer[0] & 0x0f
      const masked = (buffer[1] & 0x80) !== 0
      let length = buffer[1] & 0x7f
      let offset = 2

      if (length === 126) {
        if (buffer.length < 4) return
        length = buffer.readUInt16BE(2)
        offset = 4
      } else if (length === 127) {
        if (buffer.length < 10) return
        length = Number(buffer.readBigUInt64BE(2))
        offset = 10
      }

      let maskKey = null
      if (masked) {
        if (buffer.length < offset + 4) return
        maskKey = buffer.subarray(offset, offset + 4)
        offset += 4
      }

      if (buffer.length < offset + length) return

      const payload = Buffer.from(buffer.subarray(offset, offset + length))
      if (maskKey) {
        for (let i = 0; i < payload.length; i += 1) payload[i] ^= maskKey[i % 4]
      }
      buffer = buffer.subarray(offset + length)

      if (opcode === OPCODE.CLOSE) {
        try {
          socket.write(encodeFrame(OPCODE.CLOSE, ''))
        } catch {
          /* ignore */
        }
        socket.end()
        emitClose()
        return
      }

      if (opcode === OPCODE.PING) {
        socket.write(encodeFrame(OPCODE.PONG, payload))
        continue
      }

      if (opcode === OPCODE.PONG) continue

      if (opcode === OPCODE.CONT) {
        fragments.push(payload)
        if (fin) {
          const whole = Buffer.concat(fragments)
          fragments = []
          if (fragmentOpcode === OPCODE.TEXT && api._messageHandler) {
            api._messageHandler(whole.toString('utf8'))
          }
          fragmentOpcode = null
        }
        continue
      }

      if (opcode === OPCODE.TEXT || opcode === OPCODE.BINARY) {
        if (!fin) {
          fragmentOpcode = opcode
          fragments = [payload]
          continue
        }
        if (opcode === OPCODE.TEXT && api._messageHandler) {
          api._messageHandler(payload.toString('utf8'))
        }
      }
    }
  })

  socket.on('close', emitClose)
  socket.on('error', emitClose)

  return api
}

module.exports = { wrap, encodeFrame }