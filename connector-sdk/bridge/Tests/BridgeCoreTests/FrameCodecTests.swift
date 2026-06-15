// Unit tests for the frame codec. Mirrors the selfcheck's codec checks; runs in
// Xcode/CI (the Command Line Tools build these but cannot execute them, which is
// why xpc-bridge-selfcheck exists).

import Testing
import Foundation
@testable import BridgeCore

@Suite("FrameCodec")
struct FrameCodecTests {
    @Test("encodes a 4-byte big-endian length prefix + body")
    func encodesPrefix() throws {
        let body = Data(#"{"a":1}"#.utf8)
        let frame = try encodeFrame(body)
        #expect(frame.count == body.count + 4)
        let length = Int(frame[0]) << 24 | Int(frame[1]) << 16 | Int(frame[2]) << 8 | Int(frame[3])
        #expect(length == body.count)
        #expect(frame.subdata(in: 4..<frame.count) == body)
    }

    @Test("decodes a single whole frame")
    func decodesWhole() throws {
        let dec = FrameDecoder()
        let frames = try dec.push(try encodeFrame(Data(#"{"hello":"world"}"#.utf8)))
        #expect(frames.count == 1)
    }

    @Test("reassembles a frame split across chunks")
    func reassembles() throws {
        let dec = FrameDecoder()
        let frame = try encodeFrame(Data(#"{"id":"x","n":42}"#.utf8))
        #expect(try dec.push(frame.subdata(in: 0..<3)).isEmpty)
        #expect(try dec.push(frame.subdata(in: 3..<6)).isEmpty)
        #expect(try dec.push(frame.subdata(in: 6..<frame.count)).count == 1)
        #expect(dec.pending == 0)
    }

    @Test("decodes two frames delivered in one chunk")
    func twoInOne() throws {
        let dec = FrameDecoder()
        let chunk = try encodeFrame(Data(#"{"a":1}"#.utf8)) + (try encodeFrame(Data(#"{"b":2}"#.utf8)))
        #expect(try dec.push(chunk).count == 2)
    }

    @Test("holds a partial trailing frame until completed")
    func partialTrailing() throws {
        let dec = FrameDecoder()
        let f1 = try encodeFrame(Data(#"{"a":1}"#.utf8))
        let f2 = try encodeFrame(Data(#"{"b":2}"#.utf8))
        #expect(try dec.push(f1 + f2.subdata(in: 0..<2)).count == 1)
        #expect(dec.pending == 2)
        #expect(try dec.push(f2.subdata(in: 2..<f2.count)).count == 1)
    }

    @Test("refuses to encode an oversized frame")
    func oversizedEncode() {
        #expect(throws: FrameStreamError.self) {
            _ = try encodeFrame(Data(count: BridgeProtocol.maxFrameBytes + 1))
        }
    }

    @Test("rejects an inbound frame advertising a length over the cap")
    func oversizedInbound() {
        let dec = FrameDecoder()
        var header = Data(count: 4)
        let oversized = UInt32(BridgeProtocol.maxFrameBytes + 1)
        header[0] = UInt8((oversized >> 24) & 0xff)
        header[1] = UInt8((oversized >> 16) & 0xff)
        header[2] = UInt8((oversized >> 8) & 0xff)
        header[3] = UInt8(oversized & 0xff)
        #expect(throws: FrameStreamError.self) { _ = try dec.push(header) }
    }
}
