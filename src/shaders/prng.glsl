// Wang hash — fast integer hash for particle PRNG
uint wang_hash(uint seed) {
    seed = (seed ^ 61u) ^ (seed >> 16u);
    seed *= 9u;
    seed = seed ^ (seed >> 4u);
    seed *= 0x27d4eb2du;
    seed = seed ^ (seed >> 15u);
    return seed;
}

// Convert uint hash to float in [0, 1)
float hash_to_float(uint h) {
    return float(h) / 4294967296.0;
}

// Box-Muller transform: two uniform randoms -> two Gaussian randoms
vec2 box_muller(float u1, float u2) {
    float r = sqrt(-2.0 * log(max(u1, 1e-10)));
    float theta = 6.283185307 * u2;
    return vec2(r * cos(theta), r * sin(theta));
}
