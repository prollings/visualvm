'use strict';

let code_input = document.getElementById('code');
let code_btn = document.getElementById('code-submit');

let data_input = document.getElementById('data');
let data_btn = document.getElementById('hex-submit');
let ascii_btn = document.getElementById('text-submit');

let play_btn = document.getElementById('play-pause');
play_btn.innerHTML = '>';

let canvas = document.getElementById('canvas');
let ctx = canvas.getContext('2d', { alpha: false });

const csize = 64;
const pcls = idx_to_addr(0o7777);
const pcms = idx_to_addr(0o7776);
let memory = new Uint8Array(csize * csize);

let jumped = false;

let prog = [];

let running = false;
let timeout = undefined;

play_btn.addEventListener('click', ev => {
  if (running) {
    running = false;
    play_btn.innerHTML = '>';
    clearTimeout(timeout);
  } else {
    running = true;
    play_btn.innerHTML = '||';
    do_cycle();
  }
});

function idx_to_addr(idx) {
  return {
    type: 'a',
    x: idx & 0o77,
    y: (idx & 0o7700) >> 6,
    addr: idx,
  };
}

function write_byte(addr, byte) {
  memory[addr.addr] = byte;
  write_pixel(addr.x, addr.y, byte);
}

function read_byte(idx) {
  return memory[idx];
}

function write_pixel(x, y, byte) {
  let id = ctx.createImageData(1, 1);
  id.data[0] =
    (((byte & 32) >> 5) * 32) |
    (((byte & 64) >> 6) * 64) |
    (((byte & 128) >> 7) * 128);
  id.data[1] =
    (((byte & 4) >> 2) * 32) |
    (((byte & 8) >> 3) * 64) |
    (((byte & 16) >> 4) * 128);
  id.data[2] = ((byte & 1) * 63) | (((byte & 2) >> 1) * 192);
  id.data[3] = 0xff;
  ctx.putImageData(id, x, y);
}

function read_pixel(x, y) {
  const data = ctx.getImageData(x, y, 1, 1).data;
  let d = data[0];
  let byte = (d & 0b1100000) | (d & 128);
  d = data[1];
  byte |= ((d & 0b1100000) >> 3) | ((d & 128) >> 3);
  d = data[2];
  byte |= ((d & 32) >> 5) | ((d & 64) >> 5);
  return byte;
}

data_btn.addEventListener('click', _ => {
  let data = data_input.value;
  for (let iii = 0, jjj = 0; iii < data.length; iii += 2, jjj++) {
    let byte = parseInt(data.slice(iii, iii + 2), 16);
    let addr = idx_to_addr(jjj);
    write_byte(addr, byte);
  }
});

ascii_btn.addEventListener('click', _ => {
  let data = data_input.value;
  for (let iii = 0; iii < data.length; iii++) {
    let byte = data.charCodeAt(iii);
    let addr = idx_to_addr(iii);
    write_byte(addr, byte);
  }
});

function parse_addr(str, type) {
  let idx = parseInt(str.slice(-4), 8);
  let addr = idx_to_addr(idx);
  addr.type = type;
  return addr;
}

function compile(code) {
  let lines = code.split('\n');
  let labels = {};
  for (let idx in lines) {
    let line = lines[idx];
    if (line.endsWith(':')) {
      let label = line.slice(0, -1);
      labels[label] = idx - Object.keys(labels).length;
    }
  }
  let operations = [];
  for (let idx in lines) {
    let line = lines[idx];
    if (line.endsWith(':')) {
      continue;
    }
    let segs = line.replaceAll(',', '').split(' ');
    let operation = segs[0];
    let operand_strings = segs.slice(1);
    let operands = [];
    for (let str of operand_strings) {
      switch (str[0]) {
        case '$':
          operands.push(parse_addr(str, 'a'));
          break;
        case '@':
          operands.push(parse_addr(str, 'p'));
          break;
        case ':':
          operands.push(labels[str.slice(1)]);
          break;
        default:
          operands.push(parseInt(str));
      }
    }
    operations.push({ line_no: idx, operation, operands });
  }
  return operations;
}

code_btn.addEventListener('click', _ => {
  prog = compile(code_input.value);
  write_byte(pcls, 0);
  write_byte(pcms, 0);
});

function get_addr_from_ptr(ptr) {
  let x = read_byte(ptr.addr) & 0o77;
  let y = read_byte(ptr.addr - 1) & 0o77;
  return idx_to_addr(x + (y << 6));
}

function get_value(operand) {
  if (typeof operand === 'number') {
    return operand;
  } else if (operand.type === 'a') {
    return read_byte(operand.addr);
  } else {
    let addr = get_addr_from_ptr(operand);
    return read_byte(addr.addr);
  }
}

function set_byte(addr_op, value) {
  if (addr_op.type === 'a') {
    write_byte(addr_op, value);
  } else {
    let addr = get_addr_from_ptr(addr_op);
    write_byte(addr, value);
  }
}

function do_op(operation, operands) {
  switch (operation) {
    case 'cpy': {
      // copy src (1) to dst (0)
      let src = get_value(operands[1]);
      set_byte(operands[0], src);
      break;
    }
    case 'add': {
      // add L (1) and R (2) and put the result in (0)
      let l = get_value(operands[1]);
      let r = get_value(operands[2]);
      set_byte(operands[0], l + r);
      break;
    }
    case 'sub': {
      // same as add, but subtract...
      let l = get_value(operands[1]);
      let r = get_value(operands[2]);
      set_byte(operands[0], l - r);
      break;
    }
    case 'mul': {
      // same as add, but multiply...
      let l = get_value(operands[1]);
      let r = get_value(operands[2]);
      set_byte(operands[0], l * r);
      break;
    }
    case 'rng': {
      // put a random number at dest (0)
      let num = Math.random() * 255;
      set_byte(operands[0], num);
      break;
    }
    case 'jmp': {
      // set the pc to the 16 bit number at (0)
      write_byte(pcls, operands[0]);
      write_byte(pcms, operands[0] >> 8);
      jumped = true;
      break;
    }
  }
}

function do_cycle() {
  let pc = read_byte(pcls.addr) | (read_byte(pcms.addr) << 8);
  if (prog.length !== 0 && pc < prog.length) {
    let operation = prog[pc];
    do_op(operation.operation, operation.operands);
  }
  if (jumped) {
    pc = read_byte(pcls.addr) | (read_byte(pcms.addr) << 8);
    jumped = false;
  } else {
    pc += 1;
    write_byte(pcls, pc);
    write_byte(pcms, pc >> 8);
  }
  timeout = setTimeout(do_cycle, 1);
}
