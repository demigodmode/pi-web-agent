# Documentation for ChunkedEncodingError is either incorrect or very misleading

https://github.com/psf/requests/issues/7341
2026-04-06T17:50:45Z

As per https://github.com/psf/requests/issues/4771 the docs need improving, since this is caused by transient network outages.  That github bug is the best explanation of this situation currently.

The easiest fix would be to just add to the documentation on https://docs.python-requests.org/en/latest/_modules/requests/exceptions/ the fact that ChunkedEncodingError can be caused by transient network issues you will need to retry on.

Alternatively I suppose the ChunkedEncodingError errors which are transient could be relocated to some other exception code like ConnectionResetError (which is returned inside the ChunkedEncodingError).

A stack trace looks like this:

```
Traceback (most recent call last):
  File "/usr/lib/python3.13/site-packages/urllib3/response.py", line 754, in _error_catcher
    yield
  File "/usr/lib/python3.13/site-packages/urllib3/response.py", line 879, in _raw_read
    data = self._fp_read(amt, read1=read1) if not fp_closed else b""
           ~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^
  File "/usr/lib/python3.13/site-packages/urllib3/response.py", line 862, in _fp_read
    return self._fp.read(amt) if amt is not None else self._fp.read()
           ~~~~~~~~~~~~~^^^^^
  File "/usr/lib64/python3.13/http/client.py", line 484, in read
    s = self.fp.read(amt)
  File "/usr/lib64/python3.13/socket.py", line 719, in readinto
    return self._sock.recv_into(b)
           ~~~~~~~~~~~~~~~~~~~~^^^
  File "/usr/lib64/python3.13/ssl.py", line 1304, in recv_into
    return self.read(nbytes, buffer)
           ~~~~~~~~~^^^^^^^^^^^^^^^^
  File "/usr/lib64/python3.13/ssl.py", line 1138, in read
    return self._sslobj.read(len, buffer)
           ~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^
ConnectionResetError: [Errno 104] Connection reset by peer

The above exception was the direct cause of the following exception:

Traceback (most recent call last):
  File "/usr/lib/python3.13/site-packages/requests/models.py", line 820, in generate
    yield from self.raw.stream(chunk_size, decode_content=True)
  File "/usr/lib/python3.13/site-packages/urllib3/response.py", line 1066, in stream
    data = self.read(amt=amt, decode_content=decode_content)
  File "/usr/lib/python3.13/site-packages/urllib3/response.py", line 955, in read
    data = self._raw_read(amt)
  File "/usr/lib/python3.13/site-packages/urllib3/response.py", line 878, in _raw_read
    with self._error_catcher():
         ~~~~~~~~~~~~~~~~~~~^^
  File "/usr/lib64/python3.13/contextlib.py", line 162, in __exit__
    self.gen.throw(value)
    ~~~~~~~~~~~~~~^^^^^^^
  File "/usr/lib/python3.13/site-packages/urllib3/response.py", line 781, in _error_catcher
    raise ProtocolError(f"Connection broken: {e!r}", e) from e
urllib3.exceptions.ProtocolError: ("Connection broken: ConnectionResetError(104, 'Connection reset by peer')", ConnectionResetError(104, 'Connection reset by peer'))

During handling of the above exception, another exception occurred:

  [...edited out...]
  File "/usr/lib/python3.13/site-packages/requests/sessions.py", line 589, in request
    resp = self.send(prep, **send_kwargs)
  File "/usr/lib/python3.13/site-packages/requests/sessions.py", line 746, in send
    r.content
  File "/usr/lib/python3.13/site-packages/requests/models.py", line 902, in content
    self._content = b"".join(self.iter_content(CONTENT_CHUNK_SIZE)) or b""
                    ~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/usr/lib/python3.13/site-packages/requests/models.py", line 822, in generate
    raise ChunkedEncodingError(e)
requests.exceptions.ChunkedEncodingError: ("Connection broken: ConnectionResetError(104, 'Connection reset by peer')", ConnectionResetError(104, 'Connection reset by peer'))
```

---

2026-04-06T19:28:44Z

Hi @johnkw, there are a number of failure modes that can happen during chunked responses. Urllib3 [flattens most of these exceptions](https://github.com/urllib3/urllib3/blob/d150cea52b37f4633a0dff4e26339c51d23d987b/src/urllib3/response.py#L914-L926) (including both chunking issues and connection resets) to a single `ProtocolError` which is why that distinction is lost.

We could add something like "This exception may encapsulate transient connection issues." That said, I'm not sure if that's actionable information for intended usage of Requests.

You could manually retry these if needed, but we intentionally don't annotate exceptions as "retryable". That distinction would need to be placed on almost every exception and is somewhat subjective depending on your retry strategy. [Retry behavior](https://requests.readthedocs.io/en/latest/user/advanced/#example-automatic-retries) in Requests is already documented and handles the transient network issues for you. We wouldn't generally recommend trying to implement your own retry handling unless you have highly specific needs.

---

2026-04-06T19:34:21Z

Thanks, well, the current documentation seems to state that `ChunkedEncodingError` does not include transient network errors. The way I read it, the documentation seems to be assertively incorrect. But maybe it's just misleading.

(It would be great if ChunkedEncodingError only included true protocol errors.)

---

2026-04-06T19:45:43Z

> the current documentation seems to **state that ChunkedEncodingError does not include transient network errors.**

Could you link to where that's stated? I don't think it states anything about transient network issues (as many other errors don't).

Requests can't make a distinction, all we have is the generic ProtocolError. When the exception was added the ProtocolError from urllib3 was documented as being for IncompleteRead, despite other HTTPErrors being folded into it. Hence the current message wording.

I'm not saying we can't add a note about the nuance, I was more asking what decision process does that information affect?

---

2026-04-06T19:48:43Z

At https://docs.python-requests.org/en/latest/_modules/requests/exceptions/ it says 
> The server declared chunked encoding but sent an invalid chunk.

In this situation that documentation is seemingly false. The server did not send an invalid chunk. The connection was simply lost momentarily due to a routine transient network issue.

---

2026-04-06T20:11:28Z

Oh, regarding decision process: we (like I suspect most users of requests) just need to retry on all transient network issues.

---

2026-04-06T20:14:34Z

> In this situation that documentation is seemingly false. The server did not send an invalid chunk. The connection was simply lost momentarily due to a routine transient network issue.

That's an over-simplification of what's happening though, we don't actually know the issue. Whether the server forcefully reset the connection, or decided it was done before sending the correct `last-chunk` to signal termination, the ConnectionResetError is the same. It's indistinguishable whether the server sent an invalid chunk or the connection dropped for your stack trace. It likely is transient, but we're speculating.

The right answer either way is using builtin retries for urllib3, that removes transient failures from the exceptions. We can add the generic block "May be raised during network instability", but I don't know if that meaningfully improves the exception(s).

> Oh, regarding decision process: we (like I suspect most users of requests) just need to retry on all transient network issues.

Right and if that was being done, it's not possible to encounter this exception except in the case there's a consistent chunking issue.

---

2026-04-06T20:25:49Z

Are you saying that if the requests session had a retry thing like:
`session.mount('https://', requests.adapters.HTTPAdapter(max_retries=requests.adapters.Retry(total=20, backoff_factor=.1)))`
(which for the above stack trace it did not) then we wouldn't normally have seen that?

---

2026-04-06T20:29:53Z

That's correct, the HTTPAdapter will enable retries in urllib3 so those will be automatically retried until you hit your total. If you do receive the exception at that point, it's definitively not "transient".

It could be a extended server outage causing incomplete streams which I agree is still in that realm of ambiguity, but the chunked stream we're receiving is consistently not valid.

---

2026-04-06T20:37:50Z

The documentation for all of those should probably say something like: "If you are receiving this exception due to a transient network issue, consider mounting the requests.adapters.HTTPAdapter with requests.adapters.Retry enabled." then.  In both the original bug https://github.com/psf/requests/issues/4771 and this one, neither of us realized that ChunkedEncodingError would be included in that.

(And I even use requests.adapters.Retry most of the time.)

---

2026-05-20T14:58:21Z

Hello! I am a Systems Engineering student and I would like to work on this issue for a university project. I have already set up the repository locally and run the tests. Could you please assign it to me? Thank you!

---

2026-05-20T15:27:07Z

There's already a doc fixed checked into a fork for this, it just needs to be pulled into the main repo.

