script.on_init(function()
    if(remote.interfaces['some-interface']) then
        local val = remote.call('some-interface', 'some-function', 'arg')
        log(val .. ' from interface')
    end
end)

script.on_event('custom-event', function(e)
    local val = storage.val or 0
    val = val + 1.0
    log('val is ' .. val)
    storage.val = val
end)