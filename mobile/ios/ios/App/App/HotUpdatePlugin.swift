import Foundation
import Capacitor
import CryptoKit
import Security

private let updateBucket = "https://wc2-1324086514.cos.ap-guangzhou.myqcloud.com"
private let updatePreferences = UserDefaults.standard
private func updateValue(_ key: String) -> String { updatePreferences.string(forKey: "wc2.update." + key) ?? "" }
private func updateSet(_ key: String, _ value: Any?) { updatePreferences.set(value, forKey: "wc2.update." + key) }
private func releaseValid(_ value: String) -> Bool { value.range(of: "^[0-9]{14}$", options: .regularExpression) != nil }
private func updateRoot() -> URL { FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("wc2-updates", isDirectory: true) }
private func packagedRoot() -> URL { Bundle.main.bundleURL.appendingPathComponent("public", isDirectory: true) }

class Wc2BridgeViewController: CAPBridgeViewController {
    override func instanceDescriptor() -> InstanceDescriptor {
        let descriptor = super.instanceDescriptor()
        if updatePreferences.bool(forKey: "wc2.update.trial") {
            updateSet("active", updateValue("previous")); updateSet("trial", false); updateSet("ready", nil)
        }
        let active = updateValue("active"), folder = updateRoot().appendingPathComponent(active)
        if releaseValid(active) && FileManager.default.fileExists(atPath: folder.appendingPathComponent("index.html").path) { descriptor.appLocation = folder }
        return descriptor
    }
    override func capacitorDidLoad() { bridge?.registerPluginInstance(HotUpdatePlugin()) }
}

@objc(HotUpdatePlugin)
public class HotUpdatePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HotUpdatePlugin"
    public let jsName = "Wc2Updater"
    public let pluginMethods: [CAPPluginMethod] = ["status", "prepare", "activate", "ready"].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }
    private let lock = NSLock()
    private var running = false, done = 0, total = 0, downloaded = 0
    private var failure: String?
    private let key = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtwfLjT9ZSRBF0haS4Kl6H8VsYtecwjFp6xC1WkpHYxBRiPCWWOBATugSDK6Y/nIMb+6wdt60i2xkYbN8E6I7MOBGzvTquoqMLwQ7vTgTRktMU3MaDq4zeSWfXGqkJiVuvBMJjQ0R5x/6SknPsIwW/HolFAkiRgRyLx4LF5e9JpRlQg9pTw3pfLOMtnAFq6X4zfN4b9Ut+crd+wCz72VZwZ4kDEa+SVbkY/mj05hPJR5WxVzQKY9Py/vUvIKIwxLQGpHBkwqOWp/7ON2r4GM2HUspULeTw/ItQqCalKFt8MSAu2Lww/wVhL2zKbQZNKZq3DOVx0hgJ7cRRU+MgddTWQIDAQAB"
    private struct Manifest: Decodable {
        struct File: Decodable { let path: String; let size: Int; let sha256: String }
        let release: String; let shell: Int; let `protocol`: String; let base: String; let files: [File]
    }
    private struct Envelope: Decodable { let payload: String; let signature: String }
    private func error(_ message: String) -> NSError { NSError(domain: "WC2Update", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
    private func validPath(_ path: String) -> Bool {
        !path.hasPrefix("/") && !path.contains("\\") && !path.split(separator: "/", omittingEmptySubsequences: false).contains(where: { $0.isEmpty || $0 == "." || $0 == ".." })
    }
    private func hash(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
    private func fetch(_ url: URL, limit: Int) async throws -> Data {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 60)
        request.httpMethod = "GET"
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200, response.url?.host == url.host,
              data.count <= limit else { throw error("更新下载失败") }
        return data
    }
    private func manifest() async throws -> Manifest {
        let envelope = try JSONDecoder().decode(Envelope.self, from: await fetch(URL(string: updateBucket + "/updates/stable.json")!, limit: 4_000_000))
        guard let payload = Data(base64Encoded: envelope.payload), let signature = Data(base64Encoded: envelope.signature),
              let spki = Data(base64Encoded: key) else { throw error("更新签名无效") }
        // Fixed SPKI key: the 24-byte ASN.1 wrapper precedes the PKCS#1 RSA key.
        let attrs: [CFString: Any] = [kSecAttrKeyType: kSecAttrKeyTypeRSA, kSecAttrKeyClass: kSecAttrKeyClassPublic, kSecAttrKeySizeInBits: 2048]
        guard let rsa = SecKeyCreateWithData(Data(spki.dropFirst(24)) as CFData, attrs as CFDictionary, nil),
              SecKeyVerifySignature(rsa, .rsaSignatureMessagePKCS1v15SHA256, payload as CFData, signature as CFData, nil) else { throw error("更新签名无效") }
        let m = try JSONDecoder().decode(Manifest.self, from: payload)
        guard releaseValid(m.release), m.shell <= 1, m.protocol == "wc2-1", m.base == updateBucket + "/web/releases/" + m.release + "/",
              m.files.count <= 10_000 else { throw error("需要安装新版 IPA") }
        var names = Set<String>(), sum = 0
        for file in m.files {
            guard validPath(file.path), names.insert(file.path).inserted, file.size >= 0, file.size <= 100_000_000,
                  file.sha256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw error("更新文件无效") }
            sum += file.size
        }
        guard sum <= 2_000_000_000, names.contains("index.html"), names.contains("runtime-config.js") else { throw error("更新不完整") }
        return m
    }
    @objc func status(_ call: CAPPluginCall) {
        lock.lock(); defer { lock.unlock() }
        var result: [String: Any] = ["running": running, "done": done, "total": total, "downloaded": downloaded, "active": updateValue("active"), "ready": updateValue("ready"), "shell": 1]
        if let failure { result["error"] = failure }
        call.resolve(result)
    }
    @objc func prepare(_ call: CAPPluginCall) {
        lock.lock()
        if running { lock.unlock(); call.resolve(); return }
        running = true; done = 0; total = 0; downloaded = 0; failure = nil; lock.unlock()
        call.resolve()
        Task.detached { [self] in
            var staging: URL?
            do {
                let m = try await manifest()
                if m.release != updateValue("active") {
                    let fm = FileManager.default, root = updateRoot(), folder = root.appendingPathComponent(m.release + ".staging", isDirectory: true)
                    staging = folder
                    try fm.createDirectory(at: root, withIntermediateDirectories: true)
                    var attributes = URLResourceValues(); attributes.isExcludedFromBackup = true
                    var excluded = root; try excluded.setResourceValues(attributes)
                    if fm.fileExists(atPath: folder.path) { try fm.removeItem(at: folder) }
                    try fm.createDirectory(at: folder, withIntermediateDirectories: true)
                    self.setProgress(total: m.files.count)
                    for file in m.files {
                        let dest = folder.appendingPathComponent(file.path), active = updateValue("active")
                        try fm.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
                        var reused = false
                        let sources = (releaseValid(active) ? [root.appendingPathComponent(active).appendingPathComponent(file.path)] : []) + [packagedRoot().appendingPathComponent(file.path)]
                        for source in sources {
                            if let data = try? Data(contentsOf: source, options: .mappedIfSafe), data.count == file.size, hash(data) == file.sha256 {
                                try fm.copyItem(at: source, to: dest); reused = true; break
                            }
                        }
                        if !reused {
                            let data = try await fetch(URL(string: m.base)!.appendingPathComponent(file.path), limit: file.size)
                            guard data.count == file.size, hash(data) == file.sha256 else { throw error("更新文件校验失败") }
                            try data.write(to: dest, options: .atomic); self.setProgress(bytes: data.count)
                        }
                        self.setProgress(completed: 1)
                    }
                    let target = root.appendingPathComponent(m.release)
                    if fm.fileExists(atPath: target.path) { try fm.removeItem(at: target) }
                    try fm.moveItem(at: folder, to: target); updateSet("ready", m.release)
                }
            } catch {
                if let staging { try? FileManager.default.removeItem(at: staging) }
                self.setFailure(error.localizedDescription)
            }
            self.finish()
        }
    }
    private func setProgress(total: Int? = nil, bytes: Int = 0, completed: Int = 0) { lock.lock(); if let total { self.total = total }; downloaded += bytes; done += completed; lock.unlock() }
    private func setFailure(_ message: String) { lock.lock(); failure = message; lock.unlock() }
    private func finish() { lock.lock(); running = false; lock.unlock() }
    @objc func activate(_ call: CAPPluginCall) {
        lock.lock(); let busy = running; lock.unlock()
        let release = updateValue("ready")
        guard !busy, releaseValid(release), FileManager.default.fileExists(atPath: updateRoot().appendingPathComponent(release).appendingPathComponent("index.html").path) else { call.reject("更新尚未准备完成"); return }
        updateSet("previous", updateValue("active")); updateSet("active", release); updateSet("trial", true); updateSet("ready", nil)
        call.resolve()
        DispatchQueue.main.async { [weak self] in
            (self?.bridge?.viewController as? CAPBridgeViewController)?.setServerBasePath(path: updateRoot().appendingPathComponent(release).path)
            DispatchQueue.main.asyncAfter(deadline: .now() + 120) { [weak self] in
                if updatePreferences.bool(forKey: "wc2.update.trial") {
                    let previous = updateValue("previous"); updateSet("active", previous); updateSet("trial", false)
                    let path = releaseValid(previous) ? updateRoot().appendingPathComponent(previous) : packagedRoot()
                    (self?.bridge?.viewController as? CAPBridgeViewController)?.setServerBasePath(path: path.path)
                }
            }
        }
    }
    @objc func ready(_ call: CAPPluginCall) {
        updateSet("trial", false)
        let retained = Set([updateValue("active"), updateValue("previous"), updateValue("ready")])
        for folder in (try? FileManager.default.contentsOfDirectory(at: updateRoot(), includingPropertiesForKeys: nil)) ?? [] {
            if releaseValid(folder.lastPathComponent) && !retained.contains(folder.lastPathComponent) { try? FileManager.default.removeItem(at: folder) }
        }
        call.resolve()
    }
}
