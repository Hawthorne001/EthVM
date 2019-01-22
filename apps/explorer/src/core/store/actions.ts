import { Events, SocketDefaultRooms, SocketEvent } from 'ethvm-common'
import { Block, Tx, PendingTx, Uncle } from '@app/core/models'

const socket_socketNewblock = function({ commit }, raw: SocketEvent | SocketEvent[]) {
  const evs = !Array.isArray(raw) ? [raw] : raw
  evs.forEach(ev => {
    commit(Events.newBlock, ev.value)
    this._vm.$eventHub.$emit(Events.newBlock, new Block(ev.value))
  })
}

const socket_socketNewuncle = function({ commit }, raw: SocketEvent | SocketEvent[]) {
  const evs = !Array.isArray(raw) ? [raw] : raw
  evs.forEach(ev => {
    commit(Events.newUncle, ev.value)
    this._vm.$eventHub.$emit(Events.newUncle, new Uncle(ev.value))
  })
}

const socket_socketNewtx = function({ commit }, raw: SocketEvent | SocketEvent[]) {
  const evs = !Array.isArray(raw) ? [raw] : raw
  evs.forEach(ev => {
    commit(Events.newTx, ev.value)
    this._vm.$eventHub.$emit(Events.newTx, new Tx(ev.value))
  })
}

const socket_socketNewptx = function({ commit }, raw: SocketEvent | SocketEvent[]) {
  const evs = !Array.isArray(raw) ? [raw] : raw
  evs.forEach(event => {
    commit(Events.newPendingTx, event.value)
    this._vm.$eventHub.$emit(Events.newPendingTx, new PendingTx(event.value))
  })
}

// eslint-disable-next-line
const socket_socketConnect = function({}) {
  this._vm.$socket.emit(Events.join, { rooms: SocketDefaultRooms })
}

export default {
  socket_socketNewblock,
  socket_socketNewtx,
  socket_socketNewptx,
  socket_socketNewuncle,
  socket_socketConnect
}
