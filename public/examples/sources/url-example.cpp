#include <array>

constexpr int sum(std::array<int, 4> values) {
    int result = 0;
    for (int value : values) result += value;
    return result;
}

static_assert(sum({1, 2, 3, 4}) == 10);
