data:extend({
    {
        type = "bool-setting",
        name = "test-boolean-setting",
        setting_type = "startup",
        default_value = true,
        order = "1"
    },
    {
        type = "int-setting",
        name = "test-int-setting",
        setting_type = "runtime-global",
        default_value = 42,
        order = "2"
    },
    {
        type = "double-setting",
        name = "test-double-setting",
        setting_type = "runtime-per-user",
        default_value = 3.14,
        order = "3"
    },
    {
        type = "string-setting",
        name = "test-string-setting",
        setting_type = "startup",
        default_value = "str-value",
        order = "4"
    },
    {
        type = "color-setting",
        name = "test-color-setting",
        setting_type = "startup",
        default_value = { a = 1, r = 1, g = 0, b = 0},
        order = "6"
    }
})