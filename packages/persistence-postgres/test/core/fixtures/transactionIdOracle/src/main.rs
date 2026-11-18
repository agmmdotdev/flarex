use rand::{RngCore, SeedableRng};
use rand_chacha::ChaCha12Rng;

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

// Minimal scalar codec from crates/value/src/{id_v6,base32}.rs at db914cf06.
// Copyright 2026 Convex, Inc.; enclosing convex-backend/LICENSE.md.
// Base32 bit layout: Copyright (c) 2015 The base32 Developers, MIT License.
fn public_id(mut table: u32, id: &[u8; 16]) -> String {
    let mut data = Vec::new();
    loop {
        if table < 128 {
            data.push(table as u8);
            break;
        }
        data.push(((table & 127) | 128) as u8);
        table >>= 7;
    }
    data.extend_from_slice(id);
    let mut c0 = 0u8;
    let mut c1 = 0u8;
    for byte in &data {
        c0 = c0.wrapping_add(*byte);
        c1 = c1.wrapping_add(c0);
    }
    data.extend_from_slice(&[c0, c1]);
    let alphabet = b"0123456789abcdefghjkmnpqrstvwxyz";
    let mut output = String::new();
    for chunk in data.chunks(5) {
        let mut bytes = [0u8; 8];
        bytes[..chunk.len()].copy_from_slice(chunk);
        let block = u64::from_be_bytes(bytes);
        for shift in [59, 54, 49, 44, 39, 34, 29, 24] {
            output.push(alphabet[((block >> shift) & 31) as usize] as char);
        }
    }
    output.truncate((data.len() * 8).div_ceil(5));
    output
}

fn main() {
    let cases = [
        ("zero", [0u8; 32], 0u16),
        ("ascending", std::array::from_fn(|index| index as u8), 1),
        ("ones", [255u8; 32], 65535),
        ("mixed", std::array::from_fn(|index| ((index * 73 + 19) % 256) as u8), 20600),
    ];
    println!("{{\"sourcePin\":\"db914cf06e2b06ee985646611b9e12ed7a770318\",\"dependencies\":{{\"rand\":\"0.9.4\",\"rand_chacha\":\"0.9.0\",\"rand_core\":\"0.9.1\",\"ppv-lite86\":\"0.2.17\"}},\"sequences\":[");
    for (case_index, (name, seed, day)) in cases.iter().enumerate() {
        if case_index > 0 { println!(","); }
        print!("{{\"name\":\"{name}\",\"seed\":\"{}\",\"day\":{day},\"ids\":[", hex(seed));
        let mut rng = ChaCha12Rng::from_seed(*seed);
        let mut public_ids = Vec::new();
        for index in 0..33 {
            if index > 0 { print!(","); }
            let mut id = [0u8; 16];
            rng.fill_bytes(&mut id[..14]);
            id[14..].copy_from_slice(&day.to_be_bytes());
            print!("\"{}\"", hex(&id));
            public_ids.push(public_id(10001, &id));
        }
        print!("],\"tableNumber\":10001,\"publicIds\":[");
        for (index, public_id) in public_ids.iter().enumerate() {
            if index > 0 { print!(","); }
            print!("\"{public_id}\"");
        }
        print!("]}}");
    }
    println!("],\"blocks\":[");
    let counters = [0u64, 1, 3, 4, 0xffff_fffe, 0xffff_ffff, 0x1_0000_0000,
        0x0123_4567_89ab_cdef, u64::MAX - 3, u64::MAX];
    let mut first = true;
    for (name, seed, _) in &cases {
        for counter in counters {
            if !first { println!(","); }
            first = false;
            let mut rng = ChaCha12Rng::from_seed(*seed);
            rng.set_word_pos((counter as u128) * 16);
            let mut block = [0u8; 64];
            rng.fill_bytes(&mut block);
            print!("{{\"name\":\"{name}\",\"seed\":\"{}\",\"counter\":\"{counter}\",\"bytes\":\"{}\"}}", hex(seed), hex(&block));
        }
    }
    println!("],\"wrappedStreams\":[");
    for (case_index, (name, seed, _)) in cases.iter().enumerate() {
        if case_index > 0 { println!(","); }
        let counter = u64::MAX - 1;
        let mut rng = ChaCha12Rng::from_seed(*seed);
        rng.set_word_pos((counter as u128) * 16);
        let mut bytes = [0u8; 256];
        rng.fill_bytes(&mut bytes);
        print!("{{\"name\":\"{name}\",\"seed\":\"{}\",\"counter\":\"{counter}\",\"bytes\":\"{}\"}}", hex(seed), hex(&bytes));
    }
    println!("]}}");
}
