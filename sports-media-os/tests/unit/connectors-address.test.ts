import { describe, expect, it } from "vitest";

import { classifyIp, isAllowedAddress, isPublicIp, parseIPv4, parseIPv6, validateFetchUrl } from "@/lib/net/address";

describe("IP parsing", () => {
  it("accepts only canonical dotted-quad IPv4", () => {
    expect(parseIPv4("8.8.8.8")).toBe(0x08080808);
    expect(parseIPv4("255.255.255.255")).toBe(0xffffffff);
    for (const bad of ["127.1", "0177.0.0.1", "0x7f.0.0.1", "256.1.1.1", "1.2.3", "1.2.3.4.5", "", "a.b.c.d", "01.2.3.4"]) {
      expect(parseIPv4(bad), bad).toBeNull();
    }
  });

  it("parses IPv6 including :: compression, brackets and embedded IPv4", () => {
    expect(parseIPv6("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6("[::1]")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6("::")).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(parseIPv6("2001:db8::ff00:42:8329")).toEqual([0x2001, 0xdb8, 0, 0, 0, 0xff00, 0x42, 0x8329]);
    expect(parseIPv6("::ffff:127.0.0.1")).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
    expect(parseIPv6("64:ff9b::10.0.0.1")).toEqual([0x64, 0xff9b, 0, 0, 0, 0, 0x0a00, 1]);
    expect(parseIPv6("1:2:3:4:5:6:1.2.3.4")).toEqual([1, 2, 3, 4, 5, 6, 0x0102, 0x0304]);
    expect(parseIPv6("2606:4700:4700::1111")).toEqual([0x2606, 0x4700, 0x4700, 0, 0, 0, 0, 0x1111]);
  });

  it("rejects malformed IPv6 and zone ids", () => {
    for (const bad of ["1::2::3", "1:2:3:4:5:6:7:8:9", "1:2:3:4:5:6:7:8::", "fe80::1%eth0", "12345::", "::ffff:999.0.0.1", "gggg::", "1.2.3.4"]) {
      expect(parseIPv6(bad), bad).toBeNull();
    }
  });
});

describe("IP classification (SSRF policy)", () => {
  it("allows public unicast addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.215.14", "151.101.1.69", "2606:4700:4700::1111", "2a00:1450:4001:80b::200e"]) {
      expect(isPublicIp(ip), ip).toBe(true);
    }
  });

  it("treats loopback, RFC 1918, CGNAT and ULA as private (dev-relaxable)", () => {
    for (const ip of [
      "127.0.0.1",
      "127.255.255.254",
      "10.0.0.1",
      "10.255.255.255",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "100.64.0.1",
      "100.127.255.255",
      "::1",
      "fc00::1",
      "fd12:3456:789a::1",
    ]) {
      expect(classifyIp(ip), ip).toBe("private");
    }
    // range edges stay public
    for (const ip of ["172.15.255.255", "172.32.0.1", "100.63.255.255", "100.128.0.1", "11.0.0.1", "192.169.0.1"]) {
      expect(classifyIp(ip), ip).toBe("public");
    }
  });

  it("always blocks link-local / cloud metadata, this-network, multicast and reserved ranges", () => {
    for (const ip of [
      "169.254.169.254", // AWS/GCP/Azure metadata
      "169.254.170.2", // ECS task metadata
      "100.100.100.200", // Alibaba metadata (inside CGNAT)
      "192.0.0.192", // Oracle metadata
      "0.0.0.0",
      "0.1.2.3",
      "224.0.0.1",
      "239.255.255.250",
      "240.0.0.1",
      "255.255.255.255",
      "192.0.2.1",
      "198.51.100.7",
      "203.0.113.9",
      "198.18.0.1",
      "fe80::1",
      "febf::1",
      "fec0::1",
      "ff02::1",
      "::",
      "::127.0.0.1", // IPv4-compatible (deprecated)
      "2001:db8::1",
      "2001::1", // Teredo
      "2002:7f00:1::1", // 6to4 of 127.0.0.1
      "3fff::1",
      "100::1",
      "fd00:ec2::254", // AWS IMDS IPv6
    ]) {
      expect(classifyIp(ip), ip).toBe("reserved");
    }
  });

  it("classifies IPv4-mapped and NAT64 addresses by their embedded IPv4", () => {
    expect(classifyIp("::ffff:127.0.0.1")).toBe("private");
    expect(classifyIp("::ffff:7f00:1")).toBe("private");
    expect(classifyIp("::ffff:a9fe:a9fe")).toBe("reserved"); // 169.254.169.254
    expect(classifyIp("[::ffff:169.254.169.254]")).toBe("reserved");
    expect(classifyIp("0:0:0:0:0:ffff:0a00:0001")).toBe("private"); // 10.0.0.1
    expect(classifyIp("::ffff:8.8.8.8")).toBe("public");
    expect(classifyIp("64:ff9b::10.0.0.1")).toBe("private");
    expect(classifyIp("64:ff9b::8.8.8.8")).toBe("public");
  });

  it("fails closed on anything that is not an IP literal", () => {
    for (const s of ["", "localhost", "example.com", "127.1", "0x7f000001", "2130706433", "fe80::1%25eth0"]) {
      expect(classifyIp(s), s).toBe("invalid");
      expect(isPublicIp(s), s).toBe(false);
    }
  });

  it("relaxes only the private class when the dev flag is on", () => {
    expect(isAllowedAddress("127.0.0.1")).toBe(false);
    expect(isAllowedAddress("127.0.0.1", { allowPrivateNetwork: true })).toBe(true);
    expect(isAllowedAddress("192.168.0.10", { allowPrivateNetwork: true })).toBe(true);
    expect(isAllowedAddress("169.254.169.254", { allowPrivateNetwork: true })).toBe(false);
    expect(isAllowedAddress("100.100.100.200", { allowPrivateNetwork: true })).toBe(false);
    expect(isAllowedAddress("fd00:ec2::254", { allowPrivateNetwork: true })).toBe(false);
    expect(isAllowedAddress("0.0.0.0", { allowPrivateNetwork: true })).toBe(false);
    expect(isAllowedAddress("8.8.8.8")).toBe(true);
  });
});

describe("validateFetchUrl", () => {
  const blocked = (url: string, policy?: { allowPrivateNetwork?: boolean }) => {
    const r = validateFetchUrl(url, policy);
    return r.ok ? null : r.reason;
  };

  it("accepts ordinary http(s) feed URLs", () => {
    for (const url of [
      "https://feeds.bbci.co.uk/sport/football/rss.xml",
      "http://example.com/feed",
      "https://api.example.org:8443/v1/fixtures?league=39",
      "https://xn--fuball-cta.example/rss",
    ]) {
      const r = validateFetchUrl(url);
      expect(r.ok, url).toBe(true);
    }
  });

  it("rejects non-http schemes", () => {
    for (const url of ["file:///etc/passwd", "ftp://example.com/feed", "gopher://127.0.0.1:6379/_", "javascript:alert(1)", "data:text/xml,<rss/>", "ws://example.com"]) {
      expect(blocked(url), url).toMatch(/http and https/);
    }
  });

  it("rejects credentials, empty, malformed and overlong URLs", () => {
    expect(blocked("https://user:pass@example.com/feed")).toMatch(/Credentials/);
    expect(blocked("https://user@example.com/feed")).toMatch(/Credentials/);
    expect(blocked("")).toMatch(/empty/);
    expect(blocked("not a url")).toMatch(/valid URL/);
    expect(blocked(`https://example.com/${"a".repeat(2100)}`)).toMatch(/longer than/);
  });

  it("rejects private, loopback and metadata IP literals in every notation", () => {
    for (const url of [
      "http://127.0.0.1/",
      "http://127.0.0.1:5432/",
      "http://2130706433/", // decimal 127.0.0.1
      "http://0x7f000001/", // hex
      "http://0177.0.0.1/", // octal
      "http://127.1/", // short form
      "http://0/",
      "http://0.0.0.0:8080/",
      "http://10.1.2.3/",
      "http://172.20.0.5/",
      "http://192.168.0.1/admin",
      "http://100.64.1.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:a9fe:a9fe]/",
      "http://[fd00:ec2::254]/",
      "http://[fe80::1]/",
      "http://[fc00::1]/",
      "http://224.0.0.1/",
    ]) {
      expect(blocked(url), url).toMatch(/not a public internet address/);
    }
  });

  it("rejects localhost-style and metadata hostnames", () => {
    for (const url of ["http://localhost/", "http://LOCALHOST:3000/", "http://localhost./", "http://feed.localhost/", "http://metadata.google.internal/computeMetadata/v1/"]) {
      expect(blocked(url), url).not.toBeNull();
    }
  });

  it("allows loopback only with the dev flag — metadata never", () => {
    expect(blocked("http://127.0.0.1:4000/feed", { allowPrivateNetwork: true })).toBeNull();
    expect(blocked("http://localhost:4000/feed", { allowPrivateNetwork: true })).toBeNull();
    expect(blocked("http://169.254.169.254/", { allowPrivateNetwork: true })).toMatch(/not a public/);
    expect(blocked("http://metadata.google.internal/", { allowPrivateNetwork: true })).toMatch(/metadata/);
  });

  it("does not resolve DNS itself (names are checked at connect time)", () => {
    // a public-looking name that might resolve anywhere passes the static check
    expect(validateFetchUrl("http://rebind.example.test/feed").ok).toBe(true);
  });
});
