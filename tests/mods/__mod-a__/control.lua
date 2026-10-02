script.on_init(function()
    log('init from mod-a')
end)

script.on_event('custom-event', function(e)
    log('custom event from mod-a with payload ' .. e.value)
end)