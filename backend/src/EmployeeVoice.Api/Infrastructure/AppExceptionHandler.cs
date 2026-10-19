using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;

namespace EmployeeVoice.Api.Infrastructure;

public sealed class AppExceptionHandler(ILogger<AppExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        var (status, title, detail, code) = exception switch
        {
            ApiException api => (api.StatusCode, api.Title, api.Message, api.Code),
            _ => (StatusCodes.Status500InternalServerError, "Unexpected error", "The server could not complete that request.", "internal_error")
        };

        if (status >= 500)
            logger.LogError(exception, "Unhandled exception {Code}", code);
        else
            logger.LogInformation("Request rejected {Status} {Code}", status, code);

        httpContext.Response.StatusCode = status;
        await httpContext.Response.WriteAsJsonAsync(new ProblemDetails
        {
            Status = status,
            Title = title,
            Detail = detail,
            Extensions = { ["code"] = code }
        }, cancellationToken);
        return true;
    }
}
